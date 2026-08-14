import { NextResponse } from "next/server";

import { currentUser, tokenFromRequest } from "@/lib/auth/request";
import { SESSION_COOKIE, listSessions, revokeSession } from "@/lib/auth/session";

/** Who am I, and where else am I signed in. */
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return NextResponse.json({ user: null }, { status: 200 });

  return NextResponse.json({ user, devices: await listSessions(user.id) });
}

/** Sign out this device only. */
export async function DELETE(request: Request) {
  const token = await tokenFromRequest(request);
  if (token) await revokeSession(token);

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
