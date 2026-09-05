/**
 * Verifies that the registry in src/lib/stocks.ts matches Base mainnet, and
 * that the B20 ABI in src/lib/b20.ts produces the selectors published in the
 * generated IB20Asset reference.
 *
 *   node scripts/verify-onchain.mjs
 */
import { createPublicClient, http, parseAbi, toFunctionSelector, formatUnits } from "viem";
import { base } from "viem/chains";
import { readFileSync } from "node:fs";

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const client = createPublicClient({ chain: base, transport: http(RPC, { batch: true }) });

// Selectors as published at docs.base.org/specifications/b20/reference/interfaces/ib20-asset
const DOCUMENTED_SELECTORS = {
  "WAD_PRECISION()": "0x664808a8",
  "multiplier()": "0x1b3ed722",
  "toScaledBalance(uint256)": "0x04f04c99",
  "toRawBalance(uint256)": "0x0ca06c44",
  "scaledBalanceOf(address)": "0x1da24f3e",
  "uiMultiplier()": "0xa60bf13d",
  "newUIMultiplier()": "0xdc767007",
  "effectiveAt()": "0x97a4064f",
  "totalSupplyUI()": "0x9bea6429",
};

const source = readFileSync(new URL("../src/lib/stocks.ts", import.meta.url), "utf8");
const STOCKS = [...source.matchAll(
  /symbol:\s*"([^"]+)"[\s\S]*?address:\s*"(0x[0-9a-fA-F]{40})"[\s\S]*?feed:\s*"(0x[0-9a-fA-F]{40})"/g,
)].map(([, symbol, address, feed]) => ({ symbol, address, feed }));

const b20 = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function multiplier() view returns (uint256)",
]);
const feedAbi = parseAbi([
  "function description() view returns (string)",
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

console.log(`\nSelector check (${Object.keys(DOCUMENTED_SELECTORS).length} functions)`);
for (const [signature, expected] of Object.entries(DOCUMENTED_SELECTORS)) {
  const actual = toFunctionSelector(`function ${signature}`);
  if (actual !== expected) fail(`${signature} -> ${actual}, docs say ${expected}`);
  else console.log(`  ok    ${signature.padEnd(28)} ${actual}`);
}

console.log(`\nOnchain check against ${RPC} (${STOCKS.length} tokens)`);
const contracts = STOCKS.flatMap((s) => [
  { address: s.address, abi: b20, functionName: "symbol" },
  { address: s.address, abi: b20, functionName: "name" },
  { address: s.address, abi: b20, functionName: "decimals" },
  { address: s.address, abi: b20, functionName: "totalSupply" },
  { address: s.address, abi: b20, functionName: "multiplier" },
  { address: s.feed, abi: feedAbi, functionName: "description" },
  { address: s.feed, abi: feedAbi, functionName: "latestRoundData" },
]);

const results = await client.multicall({ contracts, allowFailure: true });
const now = Math.floor(Date.now() / 1000);
const STRIDE = 7;

console.log(
  `\n  ${"SYM".padEnd(8)}${"ONCHAIN".padEnd(10)}${"DEC".padEnd(5)}${"MULTIPLIER".padEnd(13)}` +
  `${"SUPPLY".padEnd(14)}${"FEED".padEnd(22)}${"PRICE".padEnd(12)}AGE`,
);

for (const [i, stock] of STOCKS.entries()) {
  const r = results.slice(i * STRIDE, i * STRIDE + STRIDE);
  const [sym, name, dec, supply, mult, desc, round] = r;

  if (sym.status !== "success") { fail(`${stock.symbol} token ${stock.address} unreachable: ${sym.error?.shortMessage ?? sym.error}`); continue; }
  if (sym.result !== stock.symbol) fail(`${stock.symbol}: onchain symbol is "${sym.result}"`);

  const decimals = Number(dec.result ?? 0);
  const multiplier = mult.status === "success" ? mult.result : null;
  const price = round.status === "success" ? Number(round.result[1]) / 1e8 : null;
  const age = round.status === "success" ? now - Number(round.result[3]) : null;

  if (round.status !== "success") fail(`${stock.symbol} feed ${stock.feed} unreachable`);
  else if (!String(desc.result ?? "").toUpperCase().includes(stock.symbol.replace(/c$/, "")))
    fail(`${stock.symbol}: feed describes itself as "${desc.result}"`);

  console.log(
    `  ${stock.symbol.padEnd(8)}${String(sym.result).padEnd(10)}${String(decimals).padEnd(5)}` +
    `${(multiplier === null ? "-" : formatUnits(multiplier, 18)).padEnd(13)}` +
    `${(supply.status === "success" ? Number(formatUnits(supply.result, decimals)).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "-").padEnd(14)}` +
    `${String(desc.result ?? "-").slice(0, 20).padEnd(22)}` +
    `${(price === null ? "-" : `$${price.toFixed(2)}`).padEnd(12)}` +
    `${age === null ? "-" : `${Math.floor(age / 60)}m`}`,
  );
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
