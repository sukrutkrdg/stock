/**
 * Builds a real swap batch for a sample slate and prints it.
 *
 *   npm run verify:route
 *
 * The `/api/quote` route refuses to price while the equity market is closed,
 * which is correct but makes the routing layer untestable on a weekend. This
 * exercises the same code — allocate, route each leg, collect the approvals —
 * without that guard, so a routing regression shows up before someone tries to
 * buy during market hours.
 *
 * Read-only: it asks the aggregator for calldata and prints it. Nothing is
 * signed and nothing is sent.
 */
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { allocate, equalWeights } from "../src/lib/slate.ts";
import { routeSwap, spendersOf, RouterError, type BuiltSwap } from "../src/lib/router.ts";
import { USDC_ADDRESS, USDC_DECIMALS } from "../src/lib/chain.ts";
import { readMarket } from "../src/lib/market.ts";

const SAMPLE = ["NVDAc", "MSFTc", "GOOGLc", "METAc"];
const BUDGET_USD = 50;
const SLIPPAGE_BPS = 100;
// A well-known address with no balance: routing does not require one, and using
// a placeholder keeps this script from needing anyone's wallet.
const TAKER = "0x0000000000000000000000000000000000000001" as Address;

const erc20Abi = parseAbi(["function approve(address spender, uint256 value) returns (bool)"]);

const legs = equalWeights(SAMPLE);
const budget = BigInt(Math.round(BUDGET_USD * 10 ** USDC_DECIMALS));
const allocations = allocate(legs, budget);

console.log(`\nSlate: ${SAMPLE.join(" · ")}  ·  $${BUDGET_USD}  ·  ${SLIPPAGE_BPS / 100}% slippage\n`);

const market = await readMarket();
const bySymbol = new Map(market.tickers.map((t) => [t.symbol, t]));
console.log(`Market: ${market.marketClosed ? "closed (last-close prices)" : "open"}\n`);

const settled = await Promise.allSettled(
  allocations.map((allocation) =>
    routeSwap({
      buyToken: allocation.stock.address,
      sellAmount: allocation.amount,
      taker: TAKER,
      slippageBps: SLIPPAGE_BPS,
    }).then((swap) => ({ allocation, swap })),
  ),
);

const priced: { allocation: (typeof allocations)[number]; swap: BuiltSwap }[] = [];
let failures = 0;

console.log(
  `  ${"LEG".padEnd(9)}${"SPEND".padEnd(10)}${"SHARES".padEnd(12)}${"ROUTE $".padEnd(11)}` +
    `${"FEED $".padEnd(11)}${"VS FEED".padEnd(10)}CALLDATA`,
);

for (const [index, result] of settled.entries()) {
  const allocation = allocations[index];
  const ticker = bySymbol.get(allocation.stock.symbol)!;
  const spend = Number(allocation.amount) / 10 ** USDC_DECIMALS;

  if (result.status === "rejected") {
    failures += 1;
    const reason =
      result.reason instanceof RouterError ? result.reason.message : String(result.reason);
    console.log(`  ${allocation.stock.symbol.padEnd(9)}${`$${spend.toFixed(2)}`.padEnd(10)}SKIPPED — ${reason}`);
    continue;
  }

  const { swap } = result.value;
  priced.push(result.value);

  const shares = Number(swap.amountOut) / 10 ** ticker.decimals;
  const effective = shares > 0 ? spend / shares : 0;
  const vsFeed = ticker.price > 0 ? ((effective - ticker.price) / ticker.price) * 100 : 0;

  console.log(
    `  ${allocation.stock.symbol.padEnd(9)}${`$${spend.toFixed(2)}`.padEnd(10)}` +
      `${shares.toFixed(6).padEnd(12)}${`$${effective.toFixed(2)}`.padEnd(11)}` +
      `${`$${ticker.price.toFixed(2)}`.padEnd(11)}` +
      `${`${vsFeed >= 0 ? "+" : ""}${vsFeed.toFixed(2)}%`.padEnd(10)}` +
      `${(swap.data.length - 2) / 2} bytes`,
  );
}

if (priced.length === 0) {
  console.log("\nNo leg routed. The aggregator has no path for any of these tokens.\n");
  process.exit(1);
}

const spenders = spendersOf(priced.map((entry) => entry.swap));
const calls: { to: Address; label: string }[] = [];

for (const spender of spenders) {
  const total = priced
    .filter((entry) => entry.swap.routerAddress.toLowerCase() === spender.toLowerCase())
    .reduce((sum, entry) => sum + entry.allocation.amount, 0n);

  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, total] });
  calls.push({
    to: USDC_ADDRESS,
    label: `approve ${(Number(total) / 10 ** USDC_DECIMALS).toFixed(2)} USDC -> ${spender}`,
  });
}
for (const { allocation, swap } of priced) {
  calls.push({ to: swap.routerAddress, label: `swap ${allocation.stock.symbol}` });
}

console.log(`\nBatch — ${calls.length} calls, one signature:`);
calls.forEach((call, index) => console.log(`  ${index + 1}. ${call.label}`));

console.log(
  `\n${spenders.length} approval${spenders.length === 1 ? "" : "s"}, ` +
    `${priced.length}/${allocations.length} legs routed` +
    `${failures ? `, ${failures} skipped` : ""}.\n`,
);

process.exit(priced.length === allocations.length ? 0 : 1);
