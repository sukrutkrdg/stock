import { encodeFunctionData, isAddress, parseAbi, type Address, type Hex } from "viem";
import { publicClient, USDC_ADDRESS, USDC_DECIMALS } from "@/lib/chain";
import { b20AssetAbi } from "@/lib/b20";
import { allocate, validateLegs, SlateError, type Leg } from "@/lib/slate";
import { routeSwap, spendersOf, RouterError, type BuiltSwap } from "@/lib/router";
import { readMarket } from "@/lib/market";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const erc20Abi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);

/** 1% default. These are thin books; 0.5% leaves too many legs reverting. */
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 500;

/**
 * Enough ETH to be confident a multi-call batch lands on Base.
 *
 * Base fees are a fraction of a cent, so this is deliberately generous rather
 * than a computed estimate: the point is to catch an empty wallet before the
 * user signs, not to price the batch to the wei.
 */
const MIN_GAS_WEI = 20_000_000_000_000n; // 0.00002 ETH

const MIN_BUDGET_USDC = 5;
const MAX_BUDGET_USDC = 50_000;

type Call = { to: Address; data: Hex; value: Hex };

export type QuoteLeg = {
  symbol: string;
  ticker: string;
  bps: number;
  sellUsdc: string;
  buyAmount: string;
  minBuyAmount: string;
  decimals: number;
  /** Effective price this route pays, for comparison against the feed. */
  effectivePrice: number;
  feedPrice: number;
  /** Positive means the route is worse than the feed. */
  premiumPercent: number;
};

export type QuoteResponse = {
  budgetUsdc: string;
  /** Total actually routed — the budget minus any skipped leg's share. */
  spentUsdc: string;
  spender: Address | null;
  legs: QuoteLeg[];
  calls: Call[];
  skipped: { symbol: string; reason: string }[];
  slippageBps: number;
  marketClosed: boolean;
};

/**
 * Turn a slate plus a USDC budget into one signable batch.
 *
 * Base Accounts are smart wallets, so the whole basket — a single approval
 * followed by one swap per leg — goes out as a single `wallet_sendCalls` batch
 * that the user signs once. That is the difference between buying a five-stock
 * slate and signing six transactions in a row, and it is why the calls are
 * assembled here rather than fired one at a time from the client.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as {
    legs?: Leg[];
    budgetUsdc?: number | string;
    taker?: string;
    slippageBps?: number;
  };

  if (!input.taker || !isAddress(input.taker)) {
    return Response.json({ error: "A connected wallet address is required." }, { status: 400 });
  }

  const budget = Number(input.budgetUsdc);
  if (!Number.isFinite(budget) || budget < MIN_BUDGET_USDC || budget > MAX_BUDGET_USDC) {
    return Response.json(
      {
        error: `Enter an amount between $${MIN_BUDGET_USDC} and $${MAX_BUDGET_USDC.toLocaleString()}.`,
      },
      { status: 400 },
    );
  }

  const slippageBps = Math.min(
    MAX_SLIPPAGE_BPS,
    Math.max(1, Math.round(Number(input.slippageBps) || DEFAULT_SLIPPAGE_BPS)),
  );

  let legs: Leg[];
  try {
    legs = validateLegs(input.legs ?? []);
  } catch (error) {
    const message = error instanceof SlateError ? error.message : "Invalid slate.";
    return Response.json({ error: message }, { status: 400 });
  }

  const taker = input.taker as Address;
  const budgetBase = BigInt(Math.round(budget * 10 ** USDC_DECIMALS));

  try {
    const [market, usdcBalance, gasBalance] = await Promise.all([
      readMarket(),
      publicClient().readContract({
        address: USDC_ADDRESS,
        abi: b20AssetAbi,
        functionName: "balanceOf",
        args: [taker],
      }) as Promise<bigint>,
      publicClient().getBalance({ address: taker }),
    ]);
    const bySymbol = new Map(market.tickers.map((t) => [t.symbol, t]));

    // Checked before building anything. Routing an unaffordable basket produces
    // a perfectly valid batch that reverts the moment it is signed, and the
    // user learns why from a wallet error rather than from the app.
    // Gas is the failure people do not see coming: the wallet has plenty of
    // USDC, the batch is valid, and the prompt still refuses with a message
    // about "resources" that never mentions ETH. Base fees are fractions of a
    // cent, so this is about having any at all rather than having enough.
    if (gasBalance < MIN_GAS_WEI) {
      return Response.json(
        {
          error:
            gasBalance === 0n
              ? "This wallet has no ETH on Base to pay gas. A few cents' worth is enough."
              : "There is not quite enough ETH on Base to cover gas for this batch.",
          gasBalance: gasBalance.toString(),
        },
        { status: 409 },
      );
    }

    if (usdcBalance < budgetBase) {
      const held = Number(usdcBalance) / 10 ** USDC_DECIMALS;
      return Response.json(
        {
          error:
            held === 0
              ? "This wallet holds no USDC on Base. Fund it first, then come back."
              : `This wallet holds $${held.toFixed(2)} USDC on Base — $${budget.toFixed(2)} is needed.`,
          usdcBalance: usdcBalance.toString(),
        },
        { status: 409 },
      );
    }

    // The feeds run 24/5, but the pools never stop. Refusing to quote out of
    // hours re-imposes exactly the market-hours limit that putting equities
    // onchain is meant to remove — someone in a different timezone is not doing
    // anything wrong by trading at midnight.
    //
    // What is genuinely different off-hours is that no arbitrage is anchoring
    // the pool to the underlying, so the price can drift and a gap in the stock
    // will not be reflected. That is a fact to put in front of the user with
    // numbers, not a reason to decide for them: the response carries
    // `marketClosed` and every leg's distance from the last close, and the
    // client requires a separate, deliberate confirmation before signing.

    const allocations = allocate(legs, budgetBase);

    const settled = await Promise.allSettled(
      allocations.map((allocation) =>
        routeSwap({
          buyToken: allocation.stock.address,
          sellAmount: allocation.amount,
          taker,
          slippageBps,
        }).then((swap) => ({ allocation, swap })),
      ),
    );

    const priced: { allocation: (typeof allocations)[number]; swap: BuiltSwap }[] = [];
    const skipped: { symbol: string; reason: string }[] = [];

    for (const [index, result] of settled.entries()) {
      const allocation = allocations[index];
      if (result.status === "fulfilled") {
        priced.push(result.value);
      } else {
        const reason =
          result.reason instanceof RouterError && /no route/i.test(result.reason.message)
            ? "No liquidity yet."
            : "Routing failed.";
        skipped.push({ symbol: allocation.stock.symbol, reason });
      }
    }

    if (priced.length === 0) {
      return Response.json(
        { error: "No leg of this slate is currently tradeable.", skipped },
        { status: 409 },
      );
    }

    const spenders = spendersOf(priced.map((entry) => entry.swap));
    const spent = priced.reduce((sum, entry) => sum + entry.allocation.amount, 0n);
    const calls: Call[] = [];

    // One approval per router, sized to exactly what this batch spends — no
    // unbounded allowance left standing on the user's wallet afterwards.
    for (const spender of spenders) {
      const forSpender = priced
        .filter((entry) => entry.swap.routerAddress.toLowerCase() === spender.toLowerCase())
        .reduce((sum, entry) => sum + entry.allocation.amount, 0n);

      calls.push({
        to: USDC_ADDRESS,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, forSpender],
        }),
        value: "0x0",
      });
    }

    const quoteLegs: QuoteLeg[] = priced.map(({ allocation, swap }) => {
      const ticker = bySymbol.get(allocation.stock.symbol)!;
      const decimals = ticker.decimals;
      const sellUsd = Number(allocation.amount) / 10 ** USDC_DECIMALS;
      const bought = Number(swap.amountOut) / 10 ** decimals;
      const effectivePrice = bought > 0 ? sellUsd / bought : 0;
      const feedPrice = ticker.price;

      // The router encodes the same tolerance into its calldata, so this is the
      // figure the swap will actually revert below — not a display estimate.
      const minBuyAmount =
        (BigInt(swap.amountOut) * BigInt(10_000 - slippageBps)) / 10_000n;

      calls.push({
        to: swap.routerAddress,
        data: swap.data,
        value: (swap.value && swap.value !== "0"
          ? `0x${BigInt(swap.value).toString(16)}`
          : "0x0") as Hex,
      });

      return {
        symbol: allocation.stock.symbol,
        ticker: allocation.stock.ticker,
        bps: allocation.bps,
        sellUsdc: allocation.amount.toString(),
        buyAmount: swap.amountOut,
        minBuyAmount: minBuyAmount.toString(),
        decimals,
        effectivePrice,
        feedPrice,
        premiumPercent:
          feedPrice > 0 && effectivePrice > 0 ? ((effectivePrice - feedPrice) / feedPrice) * 100 : 0,
      };
    });

    const response: QuoteResponse = {
      budgetUsdc: budgetBase.toString(),
      spentUsdc: spent.toString(),
      spender: spenders[0] ?? null,
      legs: quoteLegs,
      calls,
      skipped,
      slippageBps,
      marketClosed: market.marketClosed,
    };

    return Response.json(response);
  } catch (error) {
    if (error instanceof RouterError) {
      console.error("[quote] router error", error.message);
      return Response.json({ error: "Routing is unavailable right now." }, { status: 502 });
    }
    console.error("[quote] failed", error);
    return Response.json({ error: "Could not price this slate." }, { status: 500 });
  }
}
