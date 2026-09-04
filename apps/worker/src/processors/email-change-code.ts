import type { EmailChangeCodeJob } from "@behindthestory/jobs/queues";
import { openCode } from "@behindthestory/jobs/sealed-code";

import { sendEmailChangeCode } from "#email/send";

export async function processEmailChangeCode(payload: EmailChangeCodeJob) {
  const code = openCode(payload.sealedCode);
  await sendEmailChangeCode(payload.email, code, payload.expiresInMinutes);
}
