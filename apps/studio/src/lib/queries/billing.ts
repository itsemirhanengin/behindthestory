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

export type PlanChangeInput = InferRequestType<
  (typeof rpc.api.billing)[":workspaceId"]["plan"]["$post"]
>["json"];

/**
 * Moves an existing subscription between plans.
 *
 * Separate from `useStartCheckout` because it is a different act: checkout
 * takes somebody who is paying nothing to a hosted page, while this changes an
 * agreement that already exists, in place, with no redirect. Sending a
 * subscriber through checkout would open a second subscription and bill both.
 */
export function useChangePlan(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (plan: PlanChangeInput["plan"]) => {
      const res = await rpc.api.billing[":workspaceId"].plan.$post({
        param: { workspaceId: workspaceId! },
        json: { plan },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => {
      // The allowance moves with an upgrade, and the rail shows it.
      queryClient.invalidateQueries({ queryKey: keys.billing(workspaceId ?? "") });
      queryClient.invalidateQueries({ queryKey: keys.workspaces });
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

/**
 * Fetches a portal link. Deliberately does not navigate.
 *
 * The portal is somebody else's site, and sending the studio there wholesale
 * loses the way back: the provider's page has no idea what "back to the
 * manuscript" means. So the caller opens it in a new tab — and has to open
 * that tab in the click handler itself, before this request resolves, or the
 * browser treats it as a popup and blocks it. That timing is why the
 * navigation cannot live in here.
 */
export function useOpenPortal(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.billing[":workspaceId"].portal.$post({
        param: { workspaceId: workspaceId! },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    /* Whatever they did over there — cancelled, changed a card — is a change
       we have to notice on their return. */
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: keys.billing(workspaceId ?? "") }),
  });
}

/** Calls off a scheduled cancellation. */
export function useResumeSubscription(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await rpc.api.billing[":workspaceId"].resume.$post({
        param: { workspaceId: workspaceId! },
      });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.billing(workspaceId ?? "") });
      queryClient.invalidateQueries({ queryKey: keys.workspaces });
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
