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
  | { t: "f"; inputTokens: number; outputTokens: number };

export type ProseUsage = { inputTokens: number; outputTokens: number };
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
  opts: { onFinish?: (usage: ProseUsage) => void | Promise<void> } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
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
            send({ t: "d", v: part.text });
          } else if (part.type === "error") {
            console.error("[ai] stream error", part.error);
            send({ t: "e", v: describeError(part.error) });
          } else if (part.type === "finish") {
            const usage: ProseUsage = {
              inputTokens: part.totalUsage.inputTokens ?? 0,
              outputTokens: part.totalUsage.outputTokens ?? 0,
            };
            send({ t: "f", ...usage });
            await opts.onFinish?.(usage);
          }
        }
      } catch (error) {
        console.error("[ai] stream aborted", error);
        send({ t: "e", v: describeError(error) });
      } finally {
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
export async function consumeProseStream(
  res: Response,
  handlers: {
    onDelta: (text: string) => void;
    onStatus?: (phase: ProsePhase, detail?: string) => void;
    onUsage?: (usage: ProseUsage) => void;
  },
): Promise<void> {
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `AI request failed (${res.status})`);
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
