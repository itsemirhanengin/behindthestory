"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";

import { apiError } from "@/lib/query-client";
import { keys } from "@/lib/queries/keys";
import { rpc } from "@/lib/rpc";

export type CheckoutInput = InferRequestType<
  (typeof rpc.api.billing)[":workspaceId"]["checkout"]["$post"]
>["json"];

/**
 * Every workspace the account belongs to, oldest first — which is the personal
 * one created at sign-in.
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: keys.workspaces,
    queryFn: async () => {
      const res = await rpc.api.workspaces.$get();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

/** The plan and pack definitions, served rather than duplicated in the UI. */
export function useBillingCatalogue() {
  return useQuery({
    queryKey: keys.billingCatalogue,
    queryFn: async () => {
      const res = await rpc.api.billing.catalogue.$get();
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    // Definitions change on deploy, not while someone is reading the page.
    staleTime: Infinity,
  });
}

export function useBillingSummary(workspaceId: string | undefined) {
  return useQuery({
    queryKey: keys.billing(workspaceId ?? ""),
    queryFn: async () => {
      const res = await rpc.api.billing[":workspaceId"].summary.$get({
        param: { workspaceId: workspaceId! },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    enabled: Boolean(workspaceId),
    // The balance moves with every generation, so a minute-old figure here is
    // the one number on the page that would actually mislead.
    staleTime: 0,
  });
}

/**
 * Sends the writer to the provider's hosted checkout.
 *
 * A full navigation rather than a new tab: the provider redirects back to
 * `/settings/billing?checkout=success` when it is done, and a popup that the
 * browser blocks looks like a broken button.
 */
export function useStartCheckout(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async (item: CheckoutInput["item"]) => {
      const res = await rpc.api.billing[":workspaceId"].checkout.$post({
        param: { workspaceId: workspaceId! },
        json: { item },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}

/**
 * Asks the server to re-read the subscription from the provider.
 *
 * Used on return from checkout, where waiting for the webhook is a race the
 * writer can see: they paid a second ago and are looking at the page.
 */
export function useSyncBilling(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.billing[":workspaceId"].sync.$post({
        param: { workspaceId: workspaceId! },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: keys.billing(workspaceId ?? "") }),
  });
}

export function useOpenPortal(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.billing[":workspaceId"].portal.$post({
        param: { workspaceId: workspaceId! },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
}

export function useSetWorkspaceModel(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (defaultModel: string | null) => {
      const res = await rpc.api.workspaces[":workspaceId"].$patch({
        param: { workspaceId: workspaceId! },
        json: { defaultModel },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.workspaces }),
  });
}
