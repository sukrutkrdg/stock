import type { Address, Hex } from "viem";
import { CHAIN_ID, USDC_ADDRESS } from "./chain";

/**
 * Swap routing for tokenized stocks, via the KyberSwap aggregator.
 *
 * The obvious first choice was the 0x Swap API, which Base's own DeFi guide
 * documents. It does not work here: 0x answers a quote for any of the `*c`
 * equity tokens with
 *
 *   422 BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE
 *   "The buy token is not authorized for trade due to legal restrictions"
 *
 * — a compliance gate on 0x's side, not a key or configuration problem (the
 * same key quotes ordinary Base tokens fine). KyberSwap is one of the venues
 * Coinbase lists as live for tokenized stocks, routes them, and needs no API
 * key at all.
 *
 * Runs server-side. Nothing here holds keys or custody: it returns transaction
 * fields that the user's own wallet signs.
 *
 * The same two calls serve both directions. A buy spends USDC for a stock; a
 * sale spends a stock for USDC. What differs is not the routing but the
 * approval: a basket buy needs one approval on USDC, while a sale needs one per
 * stock being sold, because each is a separate token.
 */
const BASE_URL = "https://aggregator-api.kyberswap.com/base/api/v1";

/** Identifies Slate to the aggregator; required, and used for their analytics. */
const CLIENT_ID = "slate-miniapp";

export class RouterError extends Error {}

/** Opaque route description handed straight back to the build endpoint. */
export type RouteSummary = {
  tokenIn: string;
  amountIn: string;
  amountInUsd: string;
  tokenOut: string;
  amountOut: string;
  amountOutUsd: string;
  gas: string;
  [key: string]: unknown;
};

export type Route = {
  summary: RouteSummary;
  routerAddress: Address;
};

export type BuiltSwap = {
  routerAddress: Address;
  data: Hex;
  value: string;
  amountIn: string;
  amountOut: string;
  amountOutUsd: number;
};

type Envelope<T> = { code: number; message: string; data?: T };

async function call<T>(
  path: string,
  init?: RequestInit & { search?: URLSearchParams },
): Promise<T> {
  const url = init?.search ? `${BASE_URL}${path}?${init.search}` : `${BASE_URL}${path}`;

  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", "x-client-id": CLIENT_ID, ...init?.headers },
    cache: "no-store",
  });

  const body = (await response.json().catch(() => null)) as Envelope<T> | null;

  if (!response.ok || !body || body.code !== 0 || !body.data) {
    const detail = body?.message ?? `HTTP ${response.status}`;
    throw new RouterError(`KyberSwap ${path} failed: ${detail}`);
  }
  return body.data;
}

/**
 * Price a single leg. Indicative — the route is only signable once it has been
 * through `buildSwap`, which is where slippage and the recipient are bound in.
 */
export async function findRoute(args: {
  /** Token being bought. Omit when selling — proceeds always come back in USDC. */
  buyToken?: Address;
  /** Token being sold. Omit when buying — the app always spends USDC. */
  sellToken?: Address;
  sellAmount: bigint;
}): Promise<Route> {
  const tokenIn = args.sellToken ?? USDC_ADDRESS;
  const tokenOut = args.buyToken ?? USDC_ADDRESS;

  if (tokenIn === tokenOut) {
    throw new RouterError("A route needs two different tokens.");
  }

  const search = new URLSearchParams({
    tokenIn,
    tokenOut,
    amountIn: args.sellAmount.toString(),
  });

  const data = await call<{ routeSummary: RouteSummary; routerAddress: Address }>("/routes", {
    search,
  });

  if (!data.routeSummary || BigInt(data.routeSummary.amountOut ?? "0") === 0n) {
    throw new RouterError("No route available for this token.");
  }

  return { summary: data.routeSummary, routerAddress: data.routerAddress };
}

/**
 * Turn a route into calldata the wallet can sign.
 *
 * `slippageTolerance` is encoded into the calldata as a minimum output, so the
 * swap reverts rather than filling at a worse price than the user reviewed.
 */
export async function buildSwap(args: {
  route: Route;
  taker: Address;
  slippageBps: number;
}): Promise<BuiltSwap> {
  const data = await call<{
    routerAddress: Address;
    data: Hex;
    amountIn: string;
    amountOut: string;
    amountOutUsd: string;
    transactionValue?: string;
  }>("/route/build", {
    method: "POST",
    body: JSON.stringify({
      routeSummary: args.route.summary,
      sender: args.taker,
      recipient: args.taker,
      slippageTolerance: args.slippageBps,
      source: CLIENT_ID,
    }),
  });

  return {
    routerAddress: data.routerAddress ?? args.route.routerAddress,
    data: data.data,
    value: data.transactionValue ?? "0",
    amountIn: data.amountIn,
    amountOut: data.amountOut,
    amountOutUsd: Number(data.amountOutUsd ?? 0),
  };
}

/** Quote and build one leg in the two calls the aggregator requires. */
export async function routeSwap(args: {
  buyToken?: Address;
  sellToken?: Address;
  sellAmount: bigint;
  taker: Address;
  slippageBps: number;
}): Promise<BuiltSwap> {
  const route = await findRoute({
    buyToken: args.buyToken,
    sellToken: args.sellToken,
    sellAmount: args.sellAmount,
  });
  return buildSwap({ route, taker: args.taker, slippageBps: args.slippageBps });
}

/**
 * The single spender every leg of a slate buy approves.
 *
 * Every leg routes through the same aggregator router on Base, so one approval
 * covers the batch. If that ever stops being true the batch needs one approval
 * per distinct router, and this returning more than one address is the signal.
 */
export function spendersOf(swaps: BuiltSwap[]): Address[] {
  return [...new Set(swaps.map((swap) => swap.routerAddress.toLowerCase()))] as Address[];
}

export { CHAIN_ID };
