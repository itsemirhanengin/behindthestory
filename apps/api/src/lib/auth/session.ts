import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { getDb, sessions, users, type SESSION_CLIENT_VALUES } from "@/db";

export type SessionClient = (typeof SESSION_CLIENT_VALUES)[number];

export const SESSION_COOKIE = "bts_session";
export const SESSION_TTL_DAYS = 30;
/** Refreshing on every request would write on every page view. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
};

function hashToken(token: string) {
  // Unkeyed SHA-256 is right here, unlike for the OTP: the token is 256 bits of
  // randomness, so there is no candidate set to grind through.
  return createHash("sha256").update(token).digest("hex");
}

export function issueToken() {
  return randomBytes(32).toString("base64url");
}

export function sessionExpiry(from = new Date()) {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Finds or creates the account for a verified address and opens a session for
 * it, in one transaction so a first sign-in cannot leave a user without a
 * session or a session pointing at a half-written user.
 */
export async function startSession(input: {
  email: string;
  client: SessionClient;
  userAgent?: string;
  ip?: string;
}) {
  const token = issueToken();
  const expiresAt = sessionExpiry();

  const user = await getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email));

    // Passwordless means signup and signin are the same gesture: proving you
    // can read the address is the whole account-creation step.
    const account =
      existing ??
      (
        await tx
          .insert(users)
          .values({ email: input.email })
          .returning()
      )[0];

    await tx.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, account.id));

    await tx.insert(sessions).values({
      userId: account.id,
      tokenHash: hashToken(token),
      client: input.client,
      userAgent: (input.userAgent ?? "").slice(0, 400),
      ip: input.ip ?? "",
      expiresAt,
    });

    return account;
  });

  return {
    token,
    expiresAt,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    } satisfies AuthenticatedUser,
  };
}

/** Resolves a raw token to its account, or null for anything expired or revoked. */
export async function resolveSession(
  token: string | null | undefined,
): Promise<AuthenticatedUser | null> {
  if (!token) return null;

  const db = getDb();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastUsedAt: sessions.lastUsedAt,
      id: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    );

  if (!row) return null;

  if (Date.now() - row.lastUsedAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastUsedAt: new Date(), expiresAt: sessionExpiry() })
      .where(eq(sessions.id, row.sessionId));
  }

  return { id: row.id, email: row.email, displayName: row.displayName };
}

export async function revokeSession(token: string) {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)));
}

/** "Log out everywhere" — used after an account recovery or a lost device. */
export async function revokeAllSessions(userId: string) {
  await getDb()
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function listSessions(userId: string) {
  return getDb()
    .select({
      id: sessions.id,
      client: sessions.client,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(sql`${sessions.lastUsedAt} desc`);
}
