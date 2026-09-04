"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { apiError } from "@/lib/query-client";
import { keys } from "@/lib/queries/keys";
import { rpc } from "@/lib/rpc";

/**
 * The account profile.
 *
 * Every mutation here writes the row it got back straight into the cache with
 * `setQueryData` rather than invalidating. The profile form is a controlled
 * form: an invalidation would blank the fields for one frame while the refetch
 * lands, which reads as the save having wiped them.
 */

export type Profile = InferResponseType<typeof rpc.api.profile.me.$get>;
export type ProfileInput = InferRequestType<
  typeof rpc.api.profile.me.$patch
>["json"];

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: async () => {
      const res = await rpc.api.profile.me.$get();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProfileInput) => {
      const res = await rpc.api.profile.me.$patch({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(keys.profile, profile);
      // The header renders the name and avatar off the session, so a saved
      // profile that left it stale would show the old name until a reload.
      queryClient.invalidateQueries({ queryKey: keys.session });
    },
  });
}

/**
 * Is this handle free?
 *
 * A query rather than a mutation so react-query dedupes and caches it: the
 * field probes on every debounced keystroke, and typing back to a handle you
 * already tried should not cost a request.
 */
export function useUsernameAvailable(username: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.usernameAvailable(username),
    queryFn: async () => {
      const res = await rpc.api.profile["username-available"].$get({
        query: { username },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: enabled && username.length > 0,
    // Somebody else taking a handle mid-edit is caught by the write, so a
    // cached answer here is good enough for as long as the form is open.
    staleTime: 60_000,
  });
}

/**
 * Avatar upload, outside the typed client.
 *
 * The route takes raw bytes rather than JSON or multipart — see its comment —
 * and the RPC client only speaks those two, so this is a plain fetch. Still
 * same-origin, so the session cookie rides along as it does everywhere else.
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: Blob) => {
      const res = await fetch("/api/profile/me/avatar", {
        method: "POST",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw await apiError(res);
      return (await res.json()) as Profile;
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(keys.profile, profile);
      queryClient.invalidateQueries({ queryKey: keys.session });
    },
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.profile.me.avatar.$delete();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(keys.profile, profile);
      queryClient.invalidateQueries({ queryKey: keys.session });
    },
  });
}

// --- Email change ----------------------------------------------------------

/** Step one: ask for a code at the new address. Nothing has changed yet. */
export function useRequestEmailChange() {
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await rpc.api.profile.me.email.request.$post({
        json: { email },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

/** Step two: the code comes back and the address moves. */
export function useVerifyEmailChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; code: string }) => {
      const res = await rpc.api.profile.me.email.verify.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: (profile) => {
      queryClient.setQueryData(keys.profile, profile);
      queryClient.invalidateQueries({ queryKey: keys.session });
    },
  });
}
