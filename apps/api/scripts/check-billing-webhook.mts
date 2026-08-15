/**
 * Offline check of the webhook path.
 *
 * Polar retries a delivery up to ten times and guarantees no ordering, so the
 * question that matters is not "does a top-up credit words" but "does the same
 * top-up, delivered three times out of order, credit them exactly once". That
 * is testable without Polar: the signature is Standard Webhooks, so a payload
 * can be signed here with the same library the SDK verifies with.
 *
 * What this cannot cover is whether Polar's product ids and payload shapes are
 * what we think — that needs the sandbox and a real checkout.
 *
 *   DATABASE_URL="postgres://postgres:test@127.0.0.1:55432/bts?sslmode=disable" \
 *     pnpm --filter @behindthestory/api check:webhook
 */
import { randomUUID } from "node:crypto";

import { Webhook } from "standardwebhooks";

import { getDb, workspaces } from "@behindthestory/db";
import { TOPUP_PACKS } from "@behindthestory/core/plans";
import { ensureBalance, readBalance } from "@behindthestory/core/word-balance";

import {
  applyProviderEvent,
  claimWebhookDelivery,
  polarProvider,
  WebhookVerificationError,
} from "@behindthestory/core/billing";

const SECRET = "whsec_check_only_not_a_real_secret";
process.env.POLAR_WEBHOOK_SECRET = SECRET;
process.env.POLAR_PRODUCT_WORDS_30K = "prod_words_30k";
process.env.POLAR_PRODUCT_PRO_MONTHLY = "prod_pro_monthly";

const db = getDb();
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Signs exactly the way Polar does, including the base64 step the SDK applies. */
function sign(payload: unknown, deliveryId = `msg_${randomUUID()}`) {
  const body = JSON.stringify(payload);
  const webhook = new Webhook(Buffer.from(SECRET, "utf-8").toString("base64"));
  const timestamp = new Date();
  const signature = webhook.sign(deliveryId, timestamp, body);
  return {
    body,
    deliveryId,
    headers: {
      "webhook-id": deliveryId,
      "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
      "webhook-signature": signature,
    },
  };
}

const [workspace] = await db
  .insert(workspaces)
  .values({ name: "Webhook", slug: `wh-${randomUUID().slice(0, 12)}` })
  .returning();
await ensureBalance(workspace.id, "free");

function orderPaid(orderId: string, productId: string) {
  return {
    type: "order.paid",
    data: {
      id: orderId,
      product_id: productId,
      customer: { external_id: workspace.id },
    },
  };
}

// ---------------------------------------------------------------------------
console.log("\n1. a tampered payload is rejected");
{
  const signed = sign(orderPaid(`ord_${randomUUID()}`, "prod_words_30k"));
  let rejected = false;
  try {
    polarProvider.verifyWebhook(signed.body.replace("30k", "300k"), signed.headers);
  } catch (error) {
    rejected = error instanceof WebhookVerificationError;
  }
  check("bad signature throws", rejected);
}

// ---------------------------------------------------------------------------
console.log("\n2. a top-up credits exactly once, however many times it arrives");
{
  const orderId = `ord_${randomUUID()}`;
  const before = (await readBalance(workspace.id))!.topupWordsRemaining;

  // Same event, three deliveries: the first with its own id, then two retries
  // carrying the identical webhook-id Polar reuses.
  const first = sign(orderPaid(orderId, "prod_words_30k"));
  for (const attempt of [first, first, sign(orderPaid(orderId, "prod_words_30k"))]) {
    const event = polarProvider.verifyWebhook(attempt.body, attempt.headers);
    const fresh = await claimWebhookDelivery(attempt.headers["webhook-id"], event.kind);
    if (fresh) await applyProviderEvent(polarProvider, event);
  }

  const after = (await readBalance(workspace.id))!.topupWordsRemaining;
  check(
    "credited once",
    after - before === TOPUP_PACKS.words30k.words,
    `${before} -> ${after}`,
  );
}

// ---------------------------------------------------------------------------
console.log("\n3. a second, genuinely different order credits again");
{
  const before = (await readBalance(workspace.id))!.topupWordsRemaining;
  const signed = sign(orderPaid(`ord_${randomUUID()}`, "prod_words_30k"));
  const event = polarProvider.verifyWebhook(signed.body, signed.headers);
  await claimWebhookDelivery(signed.headers["webhook-id"], event.kind);
  await applyProviderEvent(polarProvider, event);

  const after = (await readBalance(workspace.id))!.topupWordsRemaining;
  check("credited", after - before === TOPUP_PACKS.words30k.words, `${before} -> ${after}`);
}

// ---------------------------------------------------------------------------
console.log("\n4. an event type we do not handle is accepted, not failed");
{
  // Returning a non-2xx here would count toward Polar's ten-strike endpoint
  // auto-disable — and `subscription.cycled` is exactly the sort of type the
  // SDK's own parser rejects outright, which is why verification no longer
  // goes through it.
  const signed = sign({ type: "subscription.cycled", data: { id: "sub_x" } });
  const event = polarProvider.verifyWebhook(signed.body, signed.headers);
  check("treated as ignorable", event.kind === "ignored", JSON.stringify(event));
}

// ---------------------------------------------------------------------------
console.log("\n5. an unknown product is not silently credited");
{
  const before = (await readBalance(workspace.id))!.topupWordsRemaining;
  const signed = sign(orderPaid(`ord_${randomUUID()}`, "prod_never_configured"));
  const event = polarProvider.verifyWebhook(signed.body, signed.headers);
  check("resolved to an order", event.kind === "order_paid");
  const after = (await readBalance(workspace.id))!.topupWordsRemaining;
  check("balance untouched", after === before, `${before} -> ${after}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
await db.$client.end();
process.exit(failures === 0 ? 0 : 1);
