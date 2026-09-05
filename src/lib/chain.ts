import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";

/**
 * Base mainnet is where the tokenized stocks live. There is no testnet
 * equivalent — the B20 Asset precompiles for equities are mainnet-only — so
 * every read in this app points at chain 8453.
 */
export const CHAIN = base;
export const CHAIN_ID = base.id;

/** CAIP-2 id, as required by the Mini App manifest's `requiredChains`. */
export const CAIP2 = `eip155:${base.id}` as const;

/** USDC on Base — the settlement currency for every slate buy and DCA charge. */
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;

let cached: PublicClient | undefined;

/**
 * Server-side reader. A dedicated RPC keeps the multicall-heavy price route off
 * the public endpoint's rate limit; without one we fall back to Base's default.
 */
export function publicClient(): PublicClient {
  if (!cached) {
    cached = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || undefined, { batch: true }),
    }) as PublicClient;
  }
  return cached;
}
