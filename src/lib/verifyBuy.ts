import { isAddress, parseAbiItem, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import { stockByAddress } from "./stocks";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export type VerifiedBuy = {
  /** Stock symbols that actually landed in the wallet. */
  received: string[];
};

/**
 * Confirm onchain that a buy really happened before it counts for anything.
 *
 * Verification looks at the receipt's `Transfer` logs rather than at
 * `transaction.from`. A Base Account is an ERC-4337 smart wallet, so the sender
 * on the receipt is a bundler, not the user — the only trustworthy statement
 * the chain makes about ownership is that tokens moved *to* this address.
 *
 * Without this the copy counter is a number the client asserts, and the
 * leaderboard is worth nothing.
 */
export async function verifyBuy(args: {
  txHash: Hex;
  owner: Address;
  expectSymbols: string[];
}): Promise<VerifiedBuy | { error: string }> {
  if (!isAddress(args.owner)) return { error: "Invalid wallet address." };
  if (!/^0x[0-9a-fA-F]{64}$/.test(args.txHash)) return { error: "Invalid transaction hash." };

  const client = publicClient();

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: args.txHash });
  } catch {
    return { error: "That transaction is not on Base yet." };
  }

  if (receipt.status !== "success") return { error: "That transaction reverted." };

  const owner = args.owner.toLowerCase();
  const expected = new Set(args.expectSymbols);
  const received = new Set<string>();

  for (const log of receipt.logs) {
    const stock = stockByAddress(log.address);
    if (!stock || !expected.has(stock.symbol)) continue;
    if (log.topics[0] !== TRANSFER_TOPIC) continue;

    // topics[2] is the indexed `to`, left-padded to 32 bytes.
    const to = `0x${log.topics[2]?.slice(26) ?? ""}`.toLowerCase();
    if (to === owner) received.add(stock.symbol);
  }

  if (received.size === 0) {
    return { error: "That transaction did not move any of this slate's stocks to your wallet." };
  }

  return { received: [...received] };
}

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export { TRANSFER_EVENT };
