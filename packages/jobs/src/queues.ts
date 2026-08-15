import { Queue, type JobsOptions } from "bullmq";

import { queueConnection } from "./connection";
import { sealCode } from "./sealed-code";

export const QUEUE_NAMES = {
  chapterIndex: "chapter-index",
  signInEmail: "sign-in-email",
  /** Releases reservations left behind by generations that never reported back. */
  wordHolds: "word-holds",
  /** Re-reads subscription state from the payment provider and fixes drift. */
  billingReconcile: "billing-reconcile",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type ChapterIndexJob = {
  chapterId: string;
  novelId: string;
};

export type SignInEmailJob = {
  email: string;
  /** Ciphertext from `sealCode`, never the code itself. */
  sealedCode: string;
  expiresInMinutes: number;
};

/** Both schedules are periodic sweeps over everything; neither takes input. */
export type ScheduledJob = Record<string, never>;

export type JobPayloads = {
  "chapter-index": ChapterIndexJob;
  "sign-in-email": SignInEmailJob;
  "word-holds": ScheduledJob;
  "billing-reconcile": ScheduledJob;
};

const queues = new Map<QueueName, Queue>();

export function getQueue<N extends QueueName>(name: N): Queue<JobPayloads[N]> {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: queueConnection() });
    queues.set(name, queue);
  }
  return queue as Queue<JobPayloads[N]>;
}

/**
 * Embedding a chapter costs money and takes a while, so a completed job is
 * dropped immediately — the result lives in `canon_chunks`, and keeping the
 * record would only block the next run under the same id. Failures are kept:
 * the status endpoint reports them, and without them a failed index would be
 * indistinguishable from one that was never requested.
 */
const RETAIN: JobsOptions = {
  removeOnComplete: true,
  removeOnFail: { count: 100 },
};

/**
 * One job per chapter. Re-requesting while queued is a no-op, not a second run.
 *
 * The chapter id is used bare rather than prefixed: BullMQ rejects a custom job
 * id containing `:`, which it reserves for its own key structure, and the queue
 * name already scopes the id.
 */
export function chapterIndexJobId(chapterId: string) {
  return chapterId;
}

export async function enqueueChapterIndex(payload: ChapterIndexJob) {
  const queue = getQueue(QUEUE_NAMES.chapterIndex);
  const jobId = chapterIndexJobId(payload.chapterId);

  // BullMQ ignores an add() whose job id already exists. A retained failure
  // would therefore make the chapter permanently unindexable, so clear it and
  // let the caller retry.
  const existing = await queue.getJob(jobId);
  if (existing && (await existing.isFailed())) await existing.remove();

  return queue.add("index", payload, {
    ...RETAIN,
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
  });
}

export type ChapterIndexState =
  | { status: "queued" | "running" }
  | { status: "failed"; reason: string | null }
  | null;

/** `null` means nothing is in flight — the caller should read the database. */
export async function chapterIndexState(chapterId: string): Promise<ChapterIndexState> {
  const job = await getQueue(QUEUE_NAMES.chapterIndex).getJob(chapterIndexJobId(chapterId));
  if (!job) return null;

  const state = await job.getState();
  if (state === "active") return { status: "running" };
  if (state === "failed") return { status: "failed", reason: job.failedReason ?? null };
  if (state === "completed") return null;
  return { status: "queued" };
}

/**
 * Delivery is retried harder than indexing: a sign-in code is useless once it
 * expires, but a transient Resend failure should not cost the user the attempt.
 */
export async function enqueueSignInEmail(input: {
  email: string;
  code: string;
  expiresInMinutes: number;
}) {
  return getQueue(QUEUE_NAMES.signInEmail).add(
    "send",
    {
      email: input.email,
      sealedCode: sealCode(input.code),
      expiresInMinutes: input.expiresInMinutes,
    },
    {
      removeOnComplete: true,
      removeOnFail: { count: 100 },
      attempts: 4,
      backoff: { type: "exponential", delay: 1_000 },
    },
  );
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

/**
 * The recurring work.
 *
 * Registered from the worker on boot rather than declared in Railway, because
 * `upsertJobScheduler` is idempotent by key: restarting or scaling the worker
 * re-asserts the same two schedules instead of accumulating duplicates, and a
 * changed interval takes effect on deploy with nothing to remember to update.
 */
export const SCHEDULES = {
  /**
   * Every five minutes. A hold that outlives its generation is allowance the
   * writer cannot spend and cannot see, so the window between losing it and
   * getting it back should be short enough that nobody notices.
   */
  wordHolds: { key: "word-holds-sweep", pattern: "*/5 * * * *" },
  /**
   * Nightly. Webhooks are the fast path and this is the safety net: Polar
   * retries ten times and then drops an event silently, so without a periodic
   * re-read a single unlucky delivery would leave a workspace on the wrong
   * plan indefinitely.
   */
  billingReconcile: { key: "billing-reconcile-daily", pattern: "17 3 * * *" },
} as const;

export async function registerSchedules() {
  await getQueue(QUEUE_NAMES.wordHolds).upsertJobScheduler(
    SCHEDULES.wordHolds.key,
    { pattern: SCHEDULES.wordHolds.pattern },
    {
      name: "sweep",
      data: {},
      opts: { removeOnComplete: true, removeOnFail: { count: 50 } },
    },
  );

  await getQueue(QUEUE_NAMES.billingReconcile).upsertJobScheduler(
    SCHEDULES.billingReconcile.key,
    { pattern: SCHEDULES.billingReconcile.pattern },
    {
      name: "reconcile",
      data: {},
      opts: { removeOnComplete: true, removeOnFail: { count: 50 } },
    },
  );
}
