import { Worker } from "bullmq";

import { queueConnection } from "@behindthestory/jobs/connection";
import { QUEUE_NAMES, registerSchedules } from "@behindthestory/jobs/queues";

import { processBillingReconcile } from "#processors/billing-reconcile";
import { processChapterIndex } from "#processors/chapter-index";
import { processEmailChangeCode } from "#processors/email-change-code";
import { processSignInEmail } from "#processors/sign-in-email";
import { processWordHoldsSweep } from "#processors/word-holds";

/**
 * Indexing is embedding-bound and bursty; mail is latency-sensitive and cheap.
 * Running them as separate workers means a novel-wide reindex cannot delay a
 * sign-in code sitting behind it.
 */
const workers = [
  new Worker(QUEUE_NAMES.chapterIndex, (job) => processChapterIndex(job.data), {
    // Each job issues an embedding request per chunk, so a handful of chapters
    // in parallel is already a lot of concurrent calls to the gateway.
    concurrency: 2,
    connection: queueConnection(),
  }),
  new Worker(QUEUE_NAMES.signInEmail, (job) => processSignInEmail(job.data), {
    concurrency: 10,
    connection: queueConnection(),
  }),
  /**
   * Its own worker rather than a second handler on the sign-in queue: both are
   * codes somebody is sitting and waiting for, and a queue shared with the far
   * more frequent sign-in mail would let a burst of sign-ins delay a writer
   * staring at an empty code field.
   */
  new Worker(
    QUEUE_NAMES.emailChangeCode,
    (job) => processEmailChangeCode(job.data),
    { concurrency: 10, connection: queueConnection() },
  ),
  /**
   * The two billing sweeps. Both are periodic and both walk every affected
   * row, so a second copy running concurrently would only duplicate work —
   * hence concurrency 1. Their own operations are idempotent regardless.
   */
  new Worker(QUEUE_NAMES.wordHolds, () => processWordHoldsSweep(), {
    concurrency: 1,
    connection: queueConnection(),
  }),
  new Worker(QUEUE_NAMES.billingReconcile, () => processBillingReconcile(), {
    concurrency: 1,
    connection: queueConnection(),
  }),
];

/**
 * Asserted on every boot rather than declared in Railway. `upsertJobScheduler`
 * is keyed, so restarting or scaling the worker re-asserts the same schedules
 * instead of accumulating duplicates, and changing an interval ships with the
 * code that depends on it.
 */
await registerSchedules();

for (const worker of workers) {
  worker.on("failed", (job, error) => {
    // `job` is undefined when BullMQ could not even load the record.
    console.error(`[worker] ${worker.name} job ${job?.id ?? "?"} failed:`, error.message);
  });
  worker.on("error", (error) => {
    console.error(`[worker] ${worker.name} error:`, error.message);
  });
}

console.log(`[worker] listening on ${workers.map((w) => w.name).join(", ")}`);

/**
 * Railway sends SIGTERM before replacing a container. `close()` without the
 * force flag lets jobs already running finish; killing mid-job would leave a
 * chapter half-indexed and the writer's sign-in code unsent.
 */
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    console.log(`[worker] ${signal} received, finishing in-flight jobs`);
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  });
}
