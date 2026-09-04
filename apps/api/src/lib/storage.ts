import { S3Client, DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * The avatar bucket.
 *
 * Written against the S3 API rather than a provider SDK, so the same code runs
 * on Cloudflare R2, AWS S3, Backblaze B2 or a MinIO container — the difference
 * is `S3_ENDPOINT` and nothing else. That matters here specifically because
 * this deployment already migrated hosts once.
 *
 * ## What is configured
 *
 *   S3_ENDPOINT           https://<account>.r2.cloudflarestorage.com
 *   S3_BUCKET             behindthestory-avatars
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION             optional; "auto" suits R2, a real region suits AWS
 *   S3_PUBLIC_BASE_URL    https://avatars.behindthestory.co  (or the R2 dev URL)
 *
 * `S3_PUBLIC_BASE_URL` is separate from the endpoint on purpose. Writes go to
 * the API endpoint with credentials; reads are anonymous GETs from whatever
 * origin fronts the bucket, and on every provider those two are different
 * hosts. Avatars are public data — the profile shape says so — so they are
 * served straight from that origin rather than proxied through this service,
 * which would put an image request on the API's critical path for no gain.
 */

export class StorageNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Avatar storage is not configured: ${missing.join(", ")} missing`);
    this.name = "StorageNotConfiguredError";
  }
}

type StorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  publicBaseUrl: string;
};

function readConfig(): StorageConfig | { missing: string[] } {
  const required = {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL,
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return { missing };

  return {
    endpoint: required.S3_ENDPOINT!,
    bucket: required.S3_BUCKET!,
    accessKeyId: required.S3_ACCESS_KEY_ID!,
    secretAccessKey: required.S3_SECRET_ACCESS_KEY!,
    region: process.env.S3_REGION ?? "auto",
    publicBaseUrl: required.S3_PUBLIC_BASE_URL!,
  };
}

/**
 * The public origin, or `null` when nothing is configured.
 *
 * Deliberately not a throw: a deployment with no bucket must still be able to
 * serve profiles, it just serves them with `avatarUrl: null`. Only the upload
 * route is allowed to fail loudly.
 */
export function avatarBaseUrl(): string | null {
  const config = readConfig();
  return "missing" in config ? null : config.publicBaseUrl;
}

export function storageConfigured(): boolean {
  return avatarBaseUrl() !== null;
}

/**
 * One key to one absolute URL, or `null` when either the key or the bucket is
 * absent. Kept beside the configuration it reads so no route has to remember
 * how a key becomes a URL.
 */
export function avatarUrlFor(avatarKey: string): string | null {
  const base = avatarBaseUrl();
  if (!avatarKey || !base) return null;
  return `${base.replace(/\/$/, "")}/${avatarKey}`;
}

let client: S3Client | null = null;
let clientKey = "";

function getClient(config: StorageConfig): S3Client {
  // Re-created only when the configuration actually changes, so the pooled
  // sockets survive across requests in a long-lived container.
  const key = `${config.endpoint}|${config.region}|${config.accessKeyId}`;
  if (!client || clientKey !== key) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 and MinIO both address buckets by path; virtual-host style would
      // resolve to a hostname that does not exist on either.
      forcePathStyle: true,
    });
    clientKey = key;
  }
  return client;
}

function requireConfig(): StorageConfig {
  const config = readConfig();
  if ("missing" in config) throw new StorageNotConfiguredError(config.missing);
  return config;
}

/**
 * Stores one object and returns its key.
 *
 * The key carries a content hash rather than a fixed name per user. A stable
 * key would need cache invalidation at whatever CDN fronts the bucket, and the
 * failure mode of getting that wrong is a writer who changed their avatar and
 * still sees the old one for a day.
 */
export async function putAvatar(input: {
  userId: string;
  body: Uint8Array;
  contentType: string;
  digest: string;
  extension: string;
}): Promise<string> {
  const config = requireConfig();
  const key = `avatars/${input.userId}/${input.digest.slice(0, 16)}.${input.extension}`;

  await getClient(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
      // Immutable because the key changes whenever the bytes do.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return key;
}

/**
 * Best-effort delete of a replaced or removed avatar.
 *
 * Never allowed to fail the request that triggered it: the row has already
 * stopped pointing at this object, so a failure here leaves an orphan in the
 * bucket rather than a broken profile. Orphans are cheap; a 500 on "remove my
 * photo" is not.
 */
export async function deleteAvatar(key: string): Promise<void> {
  if (!key) return;

  try {
    const config = requireConfig();
    await getClient(config).send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
    );
  } catch (error) {
    console.error("[storage] could not delete avatar", key, error);
  }
}
