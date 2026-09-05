"use client";

import { useCallback, useState } from "react";
import { useConfig } from "wagmi";
import { sendCalls, waitForCallsStatus } from "@wagmi/core";
import type { Address, Hex } from "viem";
import { CHAIN_ID } from "@/lib/chain";
import { useWallet } from "./useWallet";
import type { SellQuoteResponse } from "@/app/api/sell/route";
import type { SellIntent } from "@/lib/sell";

export type SellStage = "idle" | "quoting" | "signing" | "confirming" | "done" | "error";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? "Request failed.");
  return payload as T;
}

/**
 * Sell positions back to USDC in one signature.
 *
 * Same batching as a buy, with a longer batch: every stock needs its own
 * approval before its swap, because each is a separate token. The server reads
 * balances from the chain when it prices the sale, so a quote is only good for
 * as long as those balances hold — the preview is re-fetched rather than
 * reused after a failure.
 */
export function useSellPositions() {
  const config = useConfig();
  const { address } = useWallet();
  const [stage, setStage] = useState<SellStage>("idle");
  const [quote, setQuote] = useState<SellQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setQuote(null);
    setError(null);
    setTxHash(null);
  }, []);

  const preview = useCallback(
    async (positions: SellIntent[]) => {
      if (!address) throw new Error("Connect a wallet first.");
      setStage("quoting");
      setError(null);
      try {
        const response = await postJson<SellQuoteResponse>("/api/sell", {
          positions,
          taker: address,
        });
        setQuote(response);
        setStage("idle");
        return response;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not price that sale.");
        setStage("error");
        throw cause;
      }
    },
    [address],
  );

  const sell = useCallback(
    async (pending: SellQuoteResponse) => {
      if (!address) throw new Error("Connect a wallet first.");
      setError(null);

      try {
        setStage("signing");
        const { id } = await sendCalls(config, {
          chainId: CHAIN_ID,
          calls: pending.calls.map((call) => ({
            to: call.to as Address,
            data: call.data as Hex,
            value: BigInt(call.value ?? "0"),
          })),
          experimental_fallback: true,
        });

        setStage("confirming");
        const status = await waitForCallsStatus(config, { id, timeout: 180_000 });
        if (status.status !== "success") {
          throw new Error("The batch did not confirm. Nothing was sold.");
        }

        const receipts = status.receipts ?? [];
        const hash = receipts[receipts.length - 1]?.transactionHash as Hex | undefined;
        setTxHash(hash ?? null);
        setStage("done");
        return hash ?? null;
      } catch (cause) {
        const message =
          cause instanceof Error
            ? /user rejected|denied/i.test(cause.message)
              ? "You cancelled the sale."
              : cause.message
            : "The sale failed.";
        setError(message);
        setStage("error");
        throw cause;
      }
    },
    [address, config],
  );

  return { stage, quote, error, txHash, preview, sell, reset, address };
}
