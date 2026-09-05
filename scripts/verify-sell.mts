/**
 * Builds a real sell batch and prints it.
 *
 *   npm run verify:sell
 *
 * `/api/sell` refuses to price while the equity market is closed, which is
 * correct and makes the sell path untestable on a weekend. This exercises the
 * same code — plan the sale, route each leg, assemble the approvals — without
 * that guard, against live liquidity.
 *
 * Balances are synthetic on purpose: the point is to prove the batch assembles
 * and the routes exist, not to touch anyone's position. Nothing is signed and
 * nothing is sent.
 */
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { planSale, type Holding } from "../src/lib/sell.ts";
import { routeSwap, RouterError, type BuiltSwap } from "../src/lib/router.ts";
import { USDC_DECIMALS } from "../src/lib/chain.ts";
import { readMarket } from "../src/lib/market.ts";
import { WAD } from "../src/lib/b20.ts";

const SAMPLE = ["NVDAc", "MSFTc", "GOOGLc", "METAc"];
const PER_LEG_USD = 25;
const SLIPPAGE_BPS = 150;
const TAKER = "0x0000000000000000000000000000000000000001" as Address;

const erc20Abi = parseAbi(["function approve(address,uint256) returns (bool)"]);

const market = await readMarket();
console.log(`\nMarket: ${market.marketClosed ? "closed (last-close prices)" : "open"}`);
console.log(`Selling ~$${PER_LEG_USD} of each · ${SLIPPAGE_BPS / 100}% slippage\n`);

// A synthetic holding worth roughly PER_LEG_USD of each stock.
const holdings = new Map<string, Holding>();
for (const symbol of SAMPLE) {
  const ticker = market.tickers.find((t) => t.symbol === symbol);
  if (!ticker || !ticker.tradable) continue;
  const tokens = PER_LEG_USD / ticker.price;
  holdings.set(symbol, {
    raw: BigInt(Math.round(tokens * 10 ** ticker.decimals)),
    decimals: ticker.decimals,
    multiplier: BigInt(ticker.multiplier || WAD.toString()),
    price: ticker.price,
  });
}

const plan = planSale(
  [...holdings.keys()].map((symbol) => ({ symbol, bps: 10_000 })),
  holdings,
);

const settled = await Promise.allSettled(
  plan.lots.map((lot) =>
    routeSwap({
      sellToken: lot.stock.address,
      sellAmount: lot.rawAmount,
      taker: TAKER,
      slippageBps: SLIPPAGE_BPS,
    }).then((swap) => ({ lot, swap })),
  ),
);

console.log(
  `  ${"LEG".padEnd(9)}${"SHARES".padEnd(12)}${"-> USDC".padEnd(11)}${"ROUTE $".padEnd(11)}` +
    `${"FEED $".padEnd(11)}${"VS FEED".padEnd(10)}CALLDATA`,
);

const priced: { lot: (typeof plan.lots)[number]; swap: BuiltSwap }[] = [];
let failures = 0;

for (const [index, result] of settled.entries()) {
  const lot = plan.lots[index];

  if (result.status === "rejected") {
    failures += 1;
    const reason = result.reason instanceof RouterError ? result.reason.message : String(result.reason);
    console.log(`  ${lot.stock.ticker.padEnd(9)}SKIPPED — ${reason}`);
    continue;
  }

  const { swap } = result.value;
  priced.push(result.value);

  const proceeds = Number(swap.amountOut) / 10 ** USDC_DECIMALS;
  const effective = lot.shares > 0 ? proceeds / lot.shares : 0;
  const feed = lot.estimatedUsd / lot.shares;
  const vs = feed > 0 ? ((effective - feed) / feed) * 100 : 0;

  console.log(
    `  ${lot.stock.ticker.padEnd(9)}${lot.shares.toFixed(6).padEnd(12)}` +
      `${`$${proceeds.toFixed(2)}`.padEnd(11)}${`$${effective.toFixed(2)}`.padEnd(11)}` +
      `${`$${feed.toFixed(2)}`.padEnd(11)}` +
      `${`${vs >= 0 ? "+" : ""}${vs.toFixed(2)}%`.padEnd(10)}` +
      `${(swap.data.length - 2) / 2} bytes`,
  );
}

if (priced.length === 0) {
  console.log("\nNo leg routed.\n");
  process.exit(1);
}

// The shape that differs from a buy: one approval per stock, not one overall.
const calls: string[] = [];
for (const { lot, swap } of priced) {
  encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [swap.routerAddress, lot.rawAmount],
  });
  calls.push(`approve ${lot.stock.ticker} ${lot.rawAmount} raw -> router`);
}
for (const { lot } of priced) calls.push(`swap ${lot.stock.ticker} -> USDC`);

const proceeds = priced.reduce((sum, entry) => sum + Number(entry.swap.amountOut), 0) / 10 ** USDC_DECIMALS;

console.log(`\nBatch — ${calls.length} calls, one signature:`);
calls.forEach((call, index) => console.log(`  ${index + 1}. ${call}`));

console.log(
  `\n${priced.length} approval${priced.length === 1 ? "" : "s"} (one per stock — a buy needs only one),` +
    ` ${priced.length}/${plan.lots.length} legs routed${failures ? `, ${failures} skipped` : ""}.`,
);
console.log(`Proceeds: $${proceeds.toFixed(2)}\n`);

process.exit(priced.length === plan.lots.length ? 0 : 1);
