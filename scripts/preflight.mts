/**
 * Is everything ready for a real buy?
 *
 *   npm run preflight -- 0xYourWallet
 *
 * Written for the first live round trip: the things that actually stop a buy
 * are an unfunded wallet and a closed market, and both are invisible in the UI
 * until you have already tapped through to signing.
 */
import { formatUnits, isAddress, type Address } from "viem";
import { publicClient, USDC_ADDRESS, USDC_DECIMALS } from "../src/lib/chain.ts";
import { b20AssetAbi } from "../src/lib/b20.ts";
import { readMarket } from "../src/lib/market.ts";

const wallet = process.argv[2];
if (!wallet || !isAddress(wallet)) {
  console.error("\nUsage: npm run preflight -- 0xYourWallet\n");
  process.exit(1);
}
const address = wallet as Address;

/** The app's own floor for a buy. Below this nothing can be routed at all. */
const MIN_BUY_USDC = 5;
/** Base gas is cents; this is a comfortable float, not a requirement. */
const TARGET_ETH = 0.001;

const client = publicClient();
const [eth, usdc, market] = await Promise.all([
  client.getBalance({ address }),
  client.readContract({
    address: USDC_ADDRESS,
    abi: b20AssetAbi,
    functionName: "balanceOf",
    args: [address],
  }),
  readMarket(),
]);

const usdcBalance = Number(formatUnits(usdc as bigint, USDC_DECIMALS));
const ethBalance = Number(formatUnits(eth, 18));

let blockers = 0;
const line = (ok: boolean, label: string, detail: string) => {
  if (!ok) blockers += 1;
  console.log(`  ${ok ? "ok  " : "BLOCK"} ${label.padEnd(22)} ${detail}`);
};

console.log(`\nPreflight for ${address}\n`);

// Blocks only when nothing at all can be bought. Reporting a shortfall against
// some notional test size just tells someone they cannot do a thing they never
// asked to do.
line(
  usdcBalance >= MIN_BUY_USDC,
  "USDC on Base",
  usdcBalance >= MIN_BUY_USDC
    ? `${usdcBalance.toFixed(2)} — buys up to $${Math.floor(usdcBalance)}`
    : `${usdcBalance.toFixed(2)} — the smallest buy is $${MIN_BUY_USDC}`,
);
line(
  ethBalance >= 0.0002,
  "ETH for gas",
  `${ethBalance.toFixed(6)} — a batch costs cents, ${TARGET_ETH} covers many`,
);

const freshest = market.tickers.reduce((min, t) => Math.min(min, t.ageSeconds), Infinity);
const lastRound = new Date(Date.now() - freshest * 1000);

// Not a blocker any more: the pools trade around the clock and the app lets
// you buy at the pool price with the deviation shown. Still worth stating,
// because it changes what the price on screen means.
console.log(
  `  note  ${"Equity market".padEnd(22)} ${
    market.marketClosed
      ? `closed — last close ${(freshest / 3600).toFixed(1)}h ago (${lastRound
          .toISOString()
          .slice(0, 16)
          .replace("T", " ")} UTC). Buys route at the pool price.`
      : `open — freshest feed ${Math.round(freshest / 60)}m old`
  }`,
);

const tradable = market.tickers.filter((t) => t.tradable);
line(
  tradable.length > 0,
  "Tradable stocks",
  `${tradable.length}/${market.tickers.length}: ${tradable.map((t) => t.ticker).join(", ")}`,
);

console.log(
  blockers === 0
    ? "\nReady. A buy will go through.\n"
    : `\n${blockers} thing(s) to sort before a buy will go through.\n`,
);

process.exit(blockers === 0 ? 0 : 1);
