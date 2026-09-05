"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Slate, Leg } from "@/lib/slate";

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? "Something went wrong.");
  return body as T;
}

export function useTrendingSlates() {
  return useQuery({
    queryKey: ["slates", "trending"],
    queryFn: async () => {
      const response = await fetch("/api/slates");
      const { slates } = await json<{ slates: Slate[] }>(response);
      return slates;
    },
  });
}

export function useSlatesFor(params: { creator?: string; holder?: string }) {
  const key = params.creator ? ["creator", params.creator] : ["holder", params.holder];
  return useQuery({
    queryKey: ["slates", ...key],
    enabled: Boolean(params.creator || params.holder),
    queryFn: async () => {
      const search = new URLSearchParams(
        params.creator ? { creator: params.creator } : { holder: params.holder! },
      );
      const response = await fetch(`/api/slates?${search}`);
      const { slates } = await json<{ slates: Slate[] }>(response);
      return slates;
    },
  });
}

export function useCreateSlate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: {
      name: string;
      legs: Leg[];
      creatorAddress?: string;
      creatorFid?: number;
      creatorName?: string;
    }) => {
      const response = await fetch("/api/slates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const { slate } = await json<{ slate: Slate }>(response);
      return slate;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["slates"] }),
  });
}
