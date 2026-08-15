import type { TextStreamPart, ToolSet } from "ai";

/**
 * A plain text stream gives the client no way to tell "the model failed" from
 * "the model finished", which is why a failed generation used to look like an
 * empty chapter. These NDJSON events carry deltas, errors and usage explicitly.
 */
export type ProseStreamEvent =
  | { t: "d"; v: string }
  | { t: "e"; v: string }
  | { t: "s"; v: ProsePhase; detail?: string }
  | { t: "f"; inputTokens: number; outputTokens: number; words: number };

/**
 * What the generation cost and produced.
 *
 * The cache and reasoning counts are subsets of the input and output totals
 * respectively — they price the call, they do not add to it. `words` is what
 * the writer is charged for, counted from the deltas as they stream rather
 * than re-derived afterwards from text nobody kept.
 */
export type ProseUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  words: number;
};

/**
 * What the client is told. The cost breakdown — cache reads, cache writes,
 * reasoning — stays server-side: it prices the call, and nothing in the UI is
 * better for knowing it.
 */
export type ProseWireUsage = Pick<
  ProseUsage,
  "inputTokens" | "outputTokens" | "words"
>;

export type ProsePhase = "context" | "model" | "writing";

type ProseStreamSource =
  | AsyncIterable<TextStreamPart<ToolSet>>
  | ((helpers: {
      status: (phase: ProsePhase, detail?: string) => void;
    }) => Promise<AsyncIterable<TextStreamPart<ToolSet>>>);

function describeError(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  if (/rate.?limit|429/i.test(message)) {
    return "The AI Gateway rate-limited this request. Wait a moment and try again.";
  }
  if (/credit|quota|billing|402/i.test(message)) {
    return "The AI Gateway rejected the request for credit or quota reasons. Check your gateway balance.";
  }
  return message || "The AI request failed.";
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function proseStreamResponse(
  source: ProseStreamSource,
  opts: {
    onFinish?: (usage: ProseUsage) => void | Promise<void>;
    /**
     * Runs once the stream is over however it ended — finished, errored, or
     * abandoned when the writer closed the tab. Billing hangs a hold release
     * off this: without it, a generation the client walked away from keeps its
     * words reserved until the sweeper notices, and the writer sees an
     * allowance that quietly shrank for no visible reason.
     */
    onSettled?: (outcome: { finished: boolean }) => void | Promise<void>;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      let finished = false;
      let words = 0;
      /** Deltas split words mid-token, so the tail is carried to the next one. */
      let pending = "";
      const send = (event: ProseStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // client hung up mid-stream
        }
      };
      try {
        const status = (phase: ProsePhase, detail?: string) =>
          send({ t: "s", v: phase, detail });
        const fullStream =
          typeof source === "function" ? await source({ status }) : source;
        let writing = false;
        for await (const part of fullStream) {
          if (part.type === "text-delta") {
            if (!writing) {
              writing = true;
              status("writing");
            }
            // Count as we go. Buffering the whole chapter only to split it
            // once at the end doubles peak memory for a number we can
            // accumulate for free.
            const chunk = pending + part.text;
            const parts = chunk.split(/\s+/);
            pending = parts.pop() ?? "";
            words += parts.filter(Boolean).length;

            send({ t: "d", v: part.text });
          } else if (part.type === "error") {
            console.error("[ai] stream error", part.error);
            send({ t: "e", v: describeError(part.error) });
          } else if (part.type === "finish") {
            if (pending.trim()) words += 1;
            pending = "";

            const usage: ProseUsage = {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
              cacheReadTokens:
                part.totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
              cacheWriteTokens:
                part.totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
              reasoningTokens:
                part.totalUsage.outputTokenDetails?.reasoningTokens ?? 0,
              words,
            };
            finished = true;
            send({
              t: "f",
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              words: usage.words,
            });
            await opts.onFinish?.(usage);
          }
        }
      } catch (error) {
        console.error("[ai] stream aborted", error);
        send({ t: "e", v: describeError(error) });
      } finally {
        // Before closing, so a slow release still runs on a client that hung
        // up — `open` is already false there, but this hook is not about the
        // socket.
        try {
          await opts.onSettled?.({ finished });
        } catch (error) {
          console.error("[ai] stream settle failed", error);
        }
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Stops proxies buffering the stream into a single response.
      "X-Accel-Buffering": "no",
    },
  });
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Reads a prose stream, invoking `onDelta` per chunk. Throws if the server
 * reported an error or if the stream closed without producing any text.
 */
/**
 * A stream that failed before it started.
 *
 * Carries the status and the machine-readable code because one of these — an
 * exhausted word balance — is a failure the UI can offer a way out of, and
 * matching on the wording of a message to detect it would break the first time
 * someone rephrased it.
 */
export class ProseStreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ProseStreamError";
  }
}

export async function consumeProseStream(
  res: Response,
  handlers: {
    onDelta: (text: string) => void;
    onStatus?: (phase: ProsePhase, detail?: string) => void;
    onUsage?: (usage: ProseWireUsage) => void;
  },
): Promise<void> {
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    throw new ProseStreamError(
      body.error ?? `AI request failed (${res.status})`,
      res.status,
      body.code,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawText = false;
  let failure: string | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: ProseStreamEvent;
    try {
      event = JSON.parse(trimmed) as ProseStreamEvent;
    } catch {
      return; // ignore a partial line we cannot parse
    }
    if (event.t === "d") {
      sawText = true;
      handlers.onDelta(event.v);
    } else if (event.t === "s") {
      handlers.onStatus?.(event.v, event.detail);
    } else if (event.t === "e") {
      failure = event.v;
    } else if (event.t === "f") {
      handlers.onUsage?.({
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        words: event.words,
      });
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer) handleLine(buffer);

  if (failure) throw new Error(failure);
  if (!sawText) {
    throw new Error(
      "The AI returned nothing. This usually means a model-access or credit problem on the AI Gateway.",
    );
  }
}
