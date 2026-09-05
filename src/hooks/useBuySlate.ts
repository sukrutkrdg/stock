"use client";

import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { sendCalls, waitForCallsStatus } from "@wagmi/core";
import type { Address, Hex } from "viem";
import { CHAIN_ID } from "@/lib/chain";
import type { QuoteResponse } from "@/app/api/quote/route";
import type { Leg } from "@/lib/slate";

export type BuyStage = "idle" | "quoting" | "signing" | "confirming" | "recording" | "done" | "error";

export type BuyResult = {
  txHash: Hex;
  received: string[];
  copies: number;
};

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
 * Buy a whole slate in one signature.
 *
 * The server assembles a single approval plus one swap per leg; here they go
 * out as one `wallet_sendCalls` batch. `experimental_fallback` keeps the flow
 * working in a plain browser wallet that has no batching — it replays the same
 * calls sequentially instead of failing outright — but inside Base App, where
 * the account is a smart wallet, the user signs exactly once for the basket.
 */
export function useBuySlate() {
  const config = useConfig();
  const { address } = useAccount();
  const [stage, setStage] = useState<BuyStage>("idle");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setQuote(null);
    setError(null);
    setResult(null);
  }, []);

  const preview = useCallback(
    async (args: { legs: Leg[]; budgetUsdc: number; slippageBps?: number }) => {
      if (!address) throw new Error("Connect a wallet first.");
      setStage("quoting");
      setError(null);
      try {
        const response = await postJson<QuoteResponse>("/api/quote", { ...args, taker: address });
        setQuote(response);
        setStage("idle");
        return response;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Could not price this slate.";
        setError(message);
        setStage("error");
        throw cause;
      }
    },
    [address],
  );

  const buy = useCallback(
    async (args: { slateId: string; quote: QuoteResponse }): Promise<BuyResult> => {
      if (!address) throw new Error("Connect a wallet first.");
      setError(null);

      try {
        setStage("signing");
        const { id } = await sendCalls(config, {
          chainId: CHAIN_ID,
          calls: args.quote.calls.map((call) => ({
            to: call.to as Address,
            data: call.data as Hex,
            value: BigInt(call.value ?? "0x0"),
          })),
          experimental_fallback: true,
        });

        setStage("confirming");
        const status = await waitForCallsStatus(config, { id, timeout: 180_000 });

        if (status.status !== "success") {
          throw new Error("The batch did not confirm. Nothing was bought.");
        }

        // The last receipt is the final swap; earlier ones are the approval and
        // the preceding legs. Any of them proves the batch landed, but the last
        // is the one whose logs carry the full set of stock transfers when the
        // wallet settles the batch as a single transaction.
        const receipts = status.receipts ?? [];
        const txHash = receipts[receipts.length - 1]?.transactionHash as Hex | undefined;
        if (!txHash) throw new Error("Confirmed, but no receipt came back.");

        setStage("recording");
        const recorded = await postJson<{ copies: number; received: string[] }>("/api/buys", {
          slateId: args.slateId,
          owner: address,
          txHash,
          // What was actually routed, not what was offered: a skipped leg's
          // share never leaves the wallet and must not be recorded as spent.
          amountUsdc: (Number(args.quote.spentUsdc ?? args.quote.budgetUsdc) / 1e6).toFixed(6),
        }).catch(() => ({ copies: 0, received: [] }));

        const outcome: BuyResult = {
          txHash,
          received: recorded.received,
          copies: recorded.copies,
        };
        setResult(outcome);
        setStage("done");
        return outcome;
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message.includes("User rejected") || cause.message.includes("denied")
              ? "You cancelled the transaction."
              : cause.message
            : "The buy failed.";
        setError(message);
        setStage("error");
        throw cause;
      }
    },
    [address, config],
  );

  return { stage, quote, error, result, preview, buy, reset, address };
}
