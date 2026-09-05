"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { unlistMessage } from "@/lib/auth";
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
      // `created` distinguishes a genuine new basket from joining one that
      // already existed — the ids are content addresses, so an identical
      // composition always resolves to the same row.
      return json<{ slate: Slate; created: boolean }>(response);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["slates"] }),
  });
}

/**
 * Unlist a basket you created.
 *
 * The wallet signs a statement naming the exact slate, and the server verifies
 * the signature recovers to the creator on record. Without that the endpoint
 * would be trusting a claimed address, which is not authorisation at all.
 */
export function useUnlistSlate() {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  return useMutation({
    mutationFn: async (slateId: string) => {
      if (!address) throw new Error("Connect a wallet first.");

      const issuedAt = new Date().toISOString();
      const signature = await signMessageAsync({
        message: unlistMessage(slateId, address, issuedAt),
      });

      const response = await fetch(`/api/slates/${encodeURIComponent(slateId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, signature, issuedAt }),
      });
      return json<{ slate: Slate; alreadyHidden: boolean }>(response);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["slates"] }),
  });
}
