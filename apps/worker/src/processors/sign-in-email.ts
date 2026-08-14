import type { SignInEmailJob } from "@behindthestory/jobs/queues";
import { openCode } from "@behindthestory/jobs/sealed-code";

import { sendSignInCode } from "#email/send";

export async function processSignInEmail(payload: SignInEmailJob) {
  const code = openCode(payload.sealedCode);
  await sendSignInCode(payload.email, code, payload.expiresInMinutes);
}
