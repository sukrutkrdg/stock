import { sendCalls, waitForCallsStatus, getCapabilities, type Config } from "@wagmi/core";
import type { Address, Hex } from "viem";
import { CHAIN_ID } from "./chain";

export type Call = { to: string; data: string; value: string };

/**
 * Sending a buy or a sell, whatever the wallet can do.
 *
 * The batch has a dependency inside it: every swap spends an allowance that the
 * approval before it grants. A smart wallet executes the whole thing atomically,
 * so the swap is never estimated in a world where the approval has not run —
 * one signature, done.
 *
 * An ordinary wallet cannot do that. It builds each transaction separately, and
 * a swap sent before its approval is mined cannot be gas-estimated at all: the
 * estimate reverts, and the wallet refuses with a message about being unable to
 * create the transaction, having spent no gas and moved nothing. Sending the
 * approvals first and *waiting* for them is the only thing that makes the swaps
 * estimable.
 *
 * So the wallet is asked what it supports rather than assumed to be one or the
 * other.
 */
export type BatchProgress =
  | { phase: "approving" }
  | { phase: "swapping" }
  | { phase: "confirming" };

export type BatchResult = {
  txHash: Hex | null;
  /** True when the whole thing went out as a single signature. */
  atomic: boolean;
};

async function supportsAtomic(config: Config, account: Address): Promise<boolean> {
  try {
    // Asking for one chain returns that chain's capabilities directly, not a
    // map keyed by chain id.
    const capabilities = (await getCapabilities(config, {
      account,
      chainId: CHAIN_ID,
    })) as { atomic?: { status?: string } };

    const atomic = capabilities?.atomic?.status;
    return atomic === "supported" || atomic === "ready";
  } catch {
    // A wallet that cannot answer the question is treated as unable — the
    // sequential path works everywhere, it just costs a second signature.
    return false;
  }
}

function toCalls(calls: Call[]) {
  return calls.map((call) => ({
    to: call.to as Address,
    data: call.data as Hex,
    value: BigInt(call.value ?? "0"),
  }));
}

async function send(config: Config, calls: Call[], timeout = 180_000) {
  const { id } = await sendCalls(config, {
    chainId: CHAIN_ID,
    calls: toCalls(calls),
    experimental_fallback: true,
  });
  const status = await waitForCallsStatus(config, { id, timeout });
  return status;
}

export async function sendBatch(args: {
  config: Config;
  account: Address;
  approvalCalls: Call[];
  swapCalls: Call[];
  onProgress?: (progress: BatchProgress) => void;
}): Promise<BatchResult> {
  const { config, account, approvalCalls, swapCalls, onProgress } = args;

  if (await supportsAtomic(config, account)) {
    onProgress?.({ phase: "confirming" });
    const status = await send(config, [...approvalCalls, ...swapCalls]);
    if (status.status !== "success") {
      throw new Error("The batch did not confirm. Nothing was bought or sold.");
    }
    const receipts = status.receipts ?? [];
    return { txHash: (receipts[receipts.length - 1]?.transactionHash as Hex) ?? null, atomic: true };
  }

  if (approvalCalls.length > 0) {
    onProgress?.({ phase: "approving" });
    const approval = await send(config, approvalCalls);
    if (approval.status !== "success") {
      throw new Error("The approval did not confirm, so nothing was traded.");
    }
  }

  onProgress?.({ phase: "swapping" });
  const swaps = await send(config, swapCalls);
  if (swaps.status !== "success") {
    // The approval landed and the swap did not. Saying so plainly beats a
    // generic failure: there is now an allowance standing that the user did not
    // end up using.
    throw new Error(
      "The approval went through but the trade did not. Nothing moved beyond the approval.",
    );
  }

  const receipts = swaps.receipts ?? [];
  return { txHash: (receipts[receipts.length - 1]?.transactionHash as Hex) ?? null, atomic: false };
}
