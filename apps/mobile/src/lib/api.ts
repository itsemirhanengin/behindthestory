import { fetch as expoFetch } from 'expo/fetch';
import { hc } from 'hono/client';

import type { AppType } from '@behindthestory/api/type';

import { getToken } from '@/lib/session';

/**
 * The app talks to the public API directly. There is no proxy to hide behind
 * and no cookie — the session travels as a bearer token, which is the mode the
 * API was built with from the start. EXPO_PUBLIC_API_URL points a dev build at
 * a local API; a release build never carries it.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.behindthestory.co';

/**
 * Every request goes through Expo's fetch rather than the global one.
 *
 * React Native's built-in fetch buffers the whole response before resolving:
 * `response.body` is not a readable stream, so an AI generation would arrive in
 * one lump after it finished instead of a word at a time. Expo's implementation
 * backs `body` with a real ReadableStream fed by native data events.
 *
 * Wiring it here rather than at the streaming call sites means there is one
 * fetch in the app and no way to reach for the wrong one by accident.
 */
async function authorizedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const token = await getToken();
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (token) headers.set('authorization', `Bearer ${token}`);

  return expoFetch(typeof input === 'string' ? input : String(input), {
    ...(init as Parameters<typeof expoFetch>[1]),
    headers: Object.fromEntries(headers.entries()),
  }) as unknown as Promise<Response>;
}

/**
 * Paths, bodies and response shapes are inferred from the server's route
 * definitions, so a change on either side is a compile error here rather than a
 * runtime surprise. Same client the studio uses; only the base URL and the
 * fetch differ.
 */
export const rpc = hc<AppType>(API_URL, { fetch: authorizedFetch });

/**
 * The part of a response this app actually reads.
 *
 * Not `Response`: React Native's `FormData` is not the DOM one, so the RPC
 * client's `ClientResponse` is structurally incompatible with the global type
 * over a method nothing here calls. Naming the three members that are used
 * keeps the call sites typed instead of casting them away.
 */
export type ApiResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

/** Reads the API's error shape, falling back to something a person can read. */
export async function apiError(res: ApiResponse): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error ?? `Request failed (${res.status})`);
}
