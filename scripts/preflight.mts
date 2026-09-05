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

/** A $25 test buy, plus room for the spread on the way back out. */
const TARGET_USDC = 30;
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

line(
  usdcBalance >= 25,
  "USDC on Base",
  `${usdcBalance.toFixed(2)} — need 25 for the test buy, ${TARGET_USDC} is comfortable`,
);
line(
  ethBalance >= 0.0002,
  "ETH for gas",
  `${ethBalance.toFixed(6)} — a batch costs cents, ${TARGET_ETH} covers many`,
);

const freshest = market.tickers.reduce((min, t) => Math.min(min, t.ageSeconds), Infinity);
const lastRound = new Date(Date.now() - freshest * 1000);

line(
  !market.marketClosed,
  "Equity market",
  market.marketClosed
    ? `closed — last Chainlink round ${(freshest / 3600).toFixed(1)}h ago (${lastRound
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")} UTC)`
    : `open — freshest feed ${Math.round(freshest / 60)}m old`,
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
