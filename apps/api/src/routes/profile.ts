import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { POV_VALUES, WRITING_GOAL_VALUES, getDb, users } from "@behindthestory/db";
import {
  PROFILE_LIMITS,
  toPrivateProfile,
  toPublicProfile,
} from "@behindthestory/core/profile";
import {
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PROBLEM_MESSAGE,
  normalizeUsername,
  usernameProblem,
} from "@behindthestory/core/username";
import { enqueueEmailChangeCode } from "@behindthestory/jobs/queues";

import {
  OTP_TTL_SECONDS,
  consumeEmailChangeCode,
  generateCode,
  normalizeEmail,
  storeEmailChangeCode,
} from "#lib/auth/otp";
import { EMAIL_CHANGE_LIMITS, rateLimit } from "#lib/auth/rate-limit";
import {
  AVATAR_MAX_BYTES,
  AVATAR_PROBLEM_MESSAGE,
  inspectAvatar,
} from "#lib/image";
import {
  StorageNotConfiguredError,
  avatarBaseUrl,
  deleteAvatar,
  putAvatar,
} from "#lib/storage";
import { requireAuth, type AuthEnv } from "#middleware/auth";

const FAILURES = {
  invalid: { status: 400, error: "That code is not right." },
  expired: { status: 400, error: "That code has expired. Request a new one." },
  exhausted: { status: 429, error: "Too many attempts. Request a new code." },
} as const;

/**
 * A single free-text field, trimmed and capped.
 *
 * `.max()` after `.trim()` on purpose: a bio of four hundred spaces is not four
 * hundred characters of bio, and rejecting it as too long would be a confusing
 * way to say "write something".
 */
const text = (max: number) => z.string().trim().max(max);

const editSchema = z.object({
  displayName: text(PROFILE_LIMITS.displayName),
  username: z.string().trim().min(USERNAME_MIN).max(USERNAME_MAX),
  bio: text(PROFILE_LIMITS.bio),
  /**
   * Free text rather than an enum of the suggestions. The suggestion list
   * exists to save typing, not to tell a writer their genre is not real.
   */
  favoriteGenres: z
    .array(text(PROFILE_LIMITS.genreLength).min(1))
    .max(PROFILE_LIMITS.favoriteGenres),
  /** Null is a stated answer — "no preference" — not a missing field. */
  preferredPov: z.enum(POV_VALUES).nullable(),
  writingGoal: z.enum(WRITING_GOAL_VALUES).nullable(),
  influences: text(PROFILE_LIMITS.influences),
  avoids: text(PROFILE_LIMITS.avoids),
});

/** Case-insensitively unique after normalisation, and never two of the same. */
function cleanGenres(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

async function loadUser(userId: string) {
  const [row] = await getDb().select().from(users).where(eq(users.id, userId));
  // A live session whose account is gone is not a 404 on a profile, it is a
  // session that should never have resolved.
  if (!row) throw new HTTPException(401, { message: "Unauthorized" });
  return row;
}

/**
 * The account profile.
 *
 * Three flows live here, and they are separate because they have different
 * proofs. Ordinary fields are a `PATCH`. The avatar is bytes, so it is its own
 * upload. The address is the credential itself, so moving it costs a code
 * mailed to the address being moved to — a `PATCH` that could change `email`
 * would mean anyone holding a stolen session could take the account outright.
 */
export const profileRoutes = new Hono<AuthEnv>()
  .get("/me", requireAuth, async (c) => {
    const row = await loadUser(c.get("user").id);
    return c.json(toPrivateProfile(row, avatarBaseUrl()));
  })

  /**
   * Live availability for the handle field.
   *
   * Answers for the caller's own handle too — "available" rather than "taken" —
   * because a form that reports your own name as unavailable while you edit the
   * field next to it looks broken.
   */
  .get(
    "/username-available",
    requireAuth,
    zValidator("query", z.object({ username: z.string() })),
    async (c) => {
      const handle = normalizeUsername(c.req.valid("query").username);
      const problem = usernameProblem(handle);
      if (problem) {
        return c.json({
          available: false,
          reason: USERNAME_PROBLEM_MESSAGE[problem],
        });
      }

      const [taken] = await getDb()
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, handle), ne(users.id, c.get("user").id)));

      return c.json({
        available: !taken,
        reason: taken ? "That handle is taken." : null,
      });
    },
  )

  .patch("/me", requireAuth, zValidator("json", editSchema), async (c) => {
    const user = c.get("user");
    const body = c.req.valid("json");
    const handle = normalizeUsername(body.username);

    const problem = usernameProblem(handle);
    if (problem) {
      throw new HTTPException(400, {
        message: USERNAME_PROBLEM_MESSAGE[problem],
      });
    }

    try {
      const [row] = await getDb()
        .update(users)
        .set({
          displayName: body.displayName,
          username: handle,
          bio: body.bio,
          favoriteGenres: cleanGenres(body.favoriteGenres),
          preferredPov: body.preferredPov,
          writingGoal: body.writingGoal,
          influences: body.influences,
          avoids: body.avoids,
        })
        .where(eq(users.id, user.id))
        .returning();

      return c.json(toPrivateProfile(row, avatarBaseUrl()));
    } catch (error) {
      // The unique index is the real check, not the availability endpoint
      // above: between that answer and this write, somebody else can take the
      // name. Catching the violation here is what makes the race harmless.
      if (isUniqueViolation(error)) {
        throw new HTTPException(409, { message: "That handle is taken." });
      }
      throw error;
    }
  })

  // --- Avatar --------------------------------------------------------------

  /**
   * Raw bytes rather than multipart.
   *
   * The client already re-encodes the image in a canvas to reach one square
   * size, so what it holds at this point is a `Blob` and nothing else — there
   * are no other form fields to carry, and multipart would only add a parser
   * between the request and the sniffing below.
   */
  .post("/me/avatar", requireAuth, async (c) => {
    const user = c.get("user");

    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > AVATAR_MAX_BYTES) {
      throw new HTTPException(413, {
        message: AVATAR_PROBLEM_MESSAGE.too_large,
      });
    }

    const bytes = new Uint8Array(await c.req.arrayBuffer());
    const inspected = inspectAvatar(bytes);
    if (!inspected.ok) {
      throw new HTTPException(inspected.problem === "too_large" ? 413 : 400, {
        message: AVATAR_PROBLEM_MESSAGE[inspected.problem],
      });
    }

    const previous = await loadUser(user.id);

    let key: string;
    try {
      key = await putAvatar({ userId: user.id, ...inspected.upload });
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        console.error(`[profile] ${error.message}`);
        throw new HTTPException(503, {
          message:
            "Avatar uploads are not set up on this deployment yet. Add the S3 bucket variables to the environment.",
        });
      }

      /**
       * The bucket refused the write.
       *
       * A misconfigured deployment, not a fault in the request, so it must not
       * fall through to the generic 500 — that told the writer "Internal error"
       * and the operator nothing but a stack trace. `AccessDenied` and
       * `NoSuchBucket` here mean the same three things every time: the bucket
       * named in `S3_BUCKET` does not exist, the token is scoped to a different
       * bucket, or it was issued read-only. Naming them is the difference
       * between a five-minute fix and an afternoon.
       */
      const name = error instanceof Error ? error.name : "unknown";
      console.error(`[profile] avatar upload rejected by the bucket (${name})`, error);
      throw new HTTPException(502, {
        message:
          "The avatar bucket refused the upload. Check that S3_BUCKET exists and that the token is scoped to it with write access.",
      });
    }

    const [row] = await getDb()
      .update(users)
      .set({ avatarKey: key })
      .where(eq(users.id, user.id))
      .returning();

    // Only after the row points at the new object, and only when it is a
    // different one — re-uploading identical bytes produces the same key, and
    // deleting it would erase the avatar that was just saved.
    if (previous.avatarKey && previous.avatarKey !== key) {
      await deleteAvatar(previous.avatarKey);
    }

    return c.json(toPrivateProfile(row, avatarBaseUrl()));
  })

  .delete("/me/avatar", requireAuth, async (c) => {
    const user = c.get("user");
    const previous = await loadUser(user.id);

    const [row] = await getDb()
      .update(users)
      .set({ avatarKey: "" })
      .where(eq(users.id, user.id))
      .returning();

    await deleteAvatar(previous.avatarKey);

    return c.json(toPrivateProfile(row, avatarBaseUrl()));
  })

  // --- Email change --------------------------------------------------------

  /**
   * Step one: mail a code to the address being moved to.
   *
   * Nothing is written here. The account keeps its current address until a code
   * from the new inbox comes back, so an abandoned or intercepted request
   * leaves the account exactly where it was.
   */
  .post(
    "/me/email/request",
    requireAuth,
    zValidator("json", z.object({ email: z.email().max(320) })),
    async (c) => {
      const user = c.get("user");
      const email = normalizeEmail(c.req.valid("json").email);

      if (email === normalizeEmail(user.email)) {
        throw new HTTPException(400, {
          message: "That is already your address.",
        });
      }

      const limit = await rateLimit(
        `email-change:user:${user.id}`,
        EMAIL_CHANGE_LIMITS.perUser.limit,
        EMAIL_CHANGE_LIMITS.perUser.windowSeconds,
      );
      if (!limit.allowed) {
        c.header("retry-after", String(limit.retryAfter));
        return c.json(
          { error: "Too many attempts. Try again later.", retryAfter: limit.retryAfter },
          429,
        );
      }

      const [taken] = await getDb()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (taken) {
        // Told plainly rather than swallowed. This does reveal that an account
        // exists for the address, which is why the endpoint is authenticated
        // and rate-limited above; the alternative is a writer moving their own
        // account watching a code that will never arrive.
        throw new HTTPException(409, {
          message: "Another account already uses that address.",
        });
      }

      const code = generateCode();
      await storeEmailChangeCode(user.id, email, code);

      try {
        await enqueueEmailChangeCode({
          email,
          code,
          expiresInMinutes: Math.round(OTP_TTL_SECONDS / 60),
        });
      } catch (error) {
        console.error("[profile] could not queue email-change code", error);
      }

      return c.json({ ok: true, email });
    },
  )

  /**
   * Step two: the code comes back, and the address moves.
   *
   * The address is re-sent rather than remembered server-side, and the code was
   * stored under a key derived from both the account and that address — so a
   * code proves the writer read *this* inbox, and cannot be replayed to land
   * the account somewhere else.
   */
  .post(
    "/me/email/verify",
    requireAuth,
    zValidator(
      "json",
      z.object({
        email: z.email().max(320),
        code: z.string().regex(/^\d{6}$/),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const email = normalizeEmail(body.email);

      const outcome = await consumeEmailChangeCode(user.id, email, body.code);
      if (outcome !== "ok") {
        const failure = FAILURES[outcome];
        return c.json({ error: failure.error }, failure.status);
      }

      try {
        const [row] = await getDb()
          .update(users)
          .set({ email })
          .where(eq(users.id, user.id))
          .returning();

        /**
         * Other sessions are deliberately left alone.
         *
         * The proof here is "you can read the new inbox", which says nothing
         * about the old one being compromised — and signing a writer out of
         * their phone because they fixed a typo in their address would be
         * punishing the common case for a threat this flow does not detect.
         */
        return c.json(toPrivateProfile(row, avatarBaseUrl()));
      } catch (error) {
        // Somebody claimed the address between the request and this write. The
        // code is already burnt, which is correct: it proved the inbox, and the
        // inbox is not the thing that failed.
        if (isUniqueViolation(error)) {
          throw new HTTPException(409, {
            message: "Another account already uses that address.",
          });
        }
        throw error;
      }
    },
  )

  /**
   * The public profile, by handle.
   *
   * Mounted last so it cannot shadow `/me` or `/username-available`. Requires a
   * session but not a relationship: the fields it returns are the ones the
   * profile shape calls public, and collaboration will read exactly this.
   */
  .get("/:username", requireAuth, async (c) => {
    const handle = normalizeUsername(c.req.param("username"));

    const [row] = await getDb()
      .select()
      .from(users)
      .where(eq(users.username, handle));
    if (!row) throw new HTTPException(404, { message: "No such writer." });

    return c.json(toPublicProfile(row, avatarBaseUrl()));
  });

const UNIQUE_VIOLATION = "23505";

/** Postgres reports the losing side of a unique index as this SQLSTATE; the
 *  driver nests it under `cause` depending on how the query was issued. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: string }).code === UNIQUE_VIOLATION) return true;
  const cause = (error as { cause?: unknown }).cause;
  return cause ? isUniqueViolation(cause) : false;
}
