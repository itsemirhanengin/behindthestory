"use client";

import { useMutation } from "@tanstack/react-query";
import type { InferRequestType } from "hono/client";

import { apiError } from "@/lib/query-client";
import { rpc } from "@/lib/rpc";

/**
 * Generation is a mutation, not a query.
 *
 * None of these are cached: asking for a character twice should produce two
 * different characters, and a continuity pass has to read the prose as it is
 * now. What the mutation wrapper buys here is pending state, error handling and
 * a single place where the request shape is tied to the server's.
 */
export function useAiContext() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.context.$post>["json"]) => {
      const res = await rpc.api.ai.context.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiCharacter() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.character.$post>["json"]) => {
      const res = await rpc.api.ai.character.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiLocation() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.location.$post>["json"]) => {
      const res = await rpc.api.ai.location.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiStyle() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.style.$post>["json"]) => {
      const res = await rpc.api.ai.style.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiOutline() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.outline.$post>["json"]) => {
      const res = await rpc.api.ai.outline.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiContinuity() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.continuity.$post>["json"]) => {
      const res = await rpc.api.ai.continuity.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiAnalyze() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.analyze.$post>["json"]) => {
      const res = await rpc.api.ai.analyze.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiRelationships() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.relationships.$post>["json"]) => {
      const res = await rpc.api.ai.relationships.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiOnboardingReading() {
  return useMutation({
    mutationFn: async (
      input: InferRequestType<typeof rpc.api.ai.onboarding.reading.$post>["json"],
    ) => {
      const res = await rpc.api.ai.onboarding.reading.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiOnboardingStyle() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.onboarding.style.$post>["json"]) => {
      const res = await rpc.api.ai.onboarding.style.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

/** Records an accept/reject, and says whether to ask for a rating. */
export function useAiFeedbackDecision() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.feedback.$post>["json"]) => {
      const res = await rpc.api.ai.feedback.$post({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}

export function useAiFeedbackRating() {
  return useMutation({
    mutationFn: async (input: InferRequestType<typeof rpc.api.ai.feedback.$patch>["json"]) => {
      const res = await rpc.api.ai.feedback.$patch({ json: input });
      if (!res.ok) throw await apiError(res);
      return res.json();
    },
  });
}
