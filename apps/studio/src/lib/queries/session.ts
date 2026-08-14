"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiError } from "@/lib/query-client";
import { keys } from "@/lib/queries/keys";
import { rpc } from "@/lib/rpc";

export function useSession() {
  return useQuery({
    queryKey: keys.session,
    queryFn: async () => {
      const res = await rpc.api.auth.session.$get();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    // A signed-out answer is as valid as a signed-in one, so this must not sit
    // stale: signing in has to be reflected immediately.
    staleTime: 0,
  });
}

export function useRequestCode() {
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await rpc.api.auth.otp.request.$post({ json: { email } });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useVerifyCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; code: string }) => {
      const res = await rpc.api.auth.otp.verify.$post({
        json: { ...input, client: "web" },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => {
      // Everything cached belonged to the signed-out state; drop all of it
      // rather than trying to reconcile whose data is whose.
      queryClient.clear();
    },
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.auth.session.$delete();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => queryClient.clear(),
  });
}
