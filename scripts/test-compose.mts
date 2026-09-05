/**
 * Invariant tests for the composer's normalisation step.
 *
 *   npm run test:compose
 *
 * The composer hands a language model a free hand over which stocks go in a
 * basket. `normalizePicks` is the boundary that makes that safe: whatever the
 * model returns — an invented ticker, a duplicate, a zero weight, more picks
 * than the limit, a stock with no liquidity — what comes out has to be a slate
 * that sums to exactly 100% and can be bought.
 *
 * These run without an API key, because they test the boundary, not the model.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePicks, ComposeError, type Composition } from "../src/lib/compose.ts";
import { MAX_LEGS, MIN_LEG_BPS, TOTAL_BPS } from "../src/lib/slate.ts";
import { STOCKS } from "../src/lib/stocks.ts";
import type { Ticker } from "../src/lib/market.ts";

/** A market where everything trades except the three with no supply today. */
const UNTRADABLE = new Set(["COINc", "CRCLc", "INTCc"]);

const TICKERS: Ticker[] = STOCKS.map((stock) => ({
  symbol: stock.symbol,
  ticker: stock.ticker,
  name: stock.name,
  address: stock.address,
  sector: stock.sector,
  color: stock.color,
  decimals: 8,
  multiplier: (10n ** 18n).toString(),
  sharesPerToken: 1,
  supply: UNTRADABLE.has(stock.symbol) ? 0 : 1000,
  tradable: !UNTRADABLE.has(stock.symbol),
  price: 100,
  updatedAt: 0,
  ageSeconds: 0,
  stale: false,
  closed: false,
}));

const pick = (symbol: string, weight: number): Composition["picks"][number] => ({
  symbol,
  weight,
  why: "because",
});

const sum = (legs: { bps: number }[]) => legs.reduce((total, leg) => total + leg.bps, 0);

test("a normal proposal becomes a slate summing to exactly 100%", () => {
  const { legs } = normalizePicks(
    [pick("NVDAc", 35), pick("MSFTc", 25), pick("GOOGLc", 20), pick("METAc", 20)],
    TICKERS,
  );
  assert.equal(sum(legs), TOTAL_BPS);
  assert.equal(legs.length, 4);
});

test("relative weights are honoured in proportion", () => {
  const { legs } = normalizePicks([pick("NVDAc", 3), pick("AAPLc", 1)], TICKERS);
  const nvda = legs.find((leg) => leg.symbol === "NVDAc")!;
  const aapl = legs.find((leg) => leg.symbol === "AAPLc")!;
  assert.equal(sum(legs), TOTAL_BPS);
  assert.equal(nvda.bps, 7500);
  assert.equal(aapl.bps, 2500);
});

test("weights on any scale normalise the same way", () => {
  const small = normalizePicks([pick("NVDAc", 3), pick("AAPLc", 1)], TICKERS).legs;
  const large = normalizePicks([pick("NVDAc", 300), pick("AAPLc", 100)], TICKERS).legs;
  const fractional = normalizePicks([pick("NVDAc", 0.75), pick("AAPLc", 0.25)], TICKERS).legs;
  assert.deepEqual(small, large);
  assert.deepEqual(small, fractional);
});

test("an invented ticker is dropped, not passed through", () => {
  const { legs, dropped } = normalizePicks(
    [pick("NVDAc", 50), pick("PLTRc", 50), pick("AAPLc", 50)],
    TICKERS,
  );
  assert.equal(sum(legs), TOTAL_BPS);
  assert.ok(!legs.some((leg) => leg.symbol === "PLTRc"));
  assert.equal(dropped.length, 1);
  assert.match(dropped[0].reason, /not a tokenized stock/i);
});

test("a stock with no liquidity is dropped with a reason the user can read", () => {
  const { legs, dropped } = normalizePicks([pick("NVDAc", 50), pick("COINc", 50)], TICKERS);
  assert.equal(sum(legs), TOTAL_BPS);
  assert.deepEqual(
    legs.map((leg) => leg.symbol),
    ["NVDAc"],
  );
  assert.match(dropped[0].reason, /liquidity/i);
});

test("duplicates collapse instead of double-counting", () => {
  const { legs } = normalizePicks(
    [pick("NVDAc", 50), pick("NVDAc", 50), pick("AAPLc", 50)],
    TICKERS,
  );
  assert.equal(legs.length, 2);
  assert.equal(sum(legs), TOTAL_BPS);
});

test("symbol matching is case-insensitive", () => {
  const { legs, dropped } = normalizePicks([pick("nvdac", 1), pick("AAPLC", 1)], TICKERS);
  assert.equal(dropped.length, 0);
  assert.equal(legs.length, 2);
  assert.equal(sum(legs), TOTAL_BPS);
});

test("more picks than the limit are truncated, not accepted", () => {
  const tradable = TICKERS.filter((t) => t.tradable).slice(0, MAX_LEGS + 2);
  const { legs, dropped } = normalizePicks(
    tradable.map((t) => pick(t.symbol, 1)),
    TICKERS,
  );
  assert.equal(legs.length, MAX_LEGS);
  assert.equal(sum(legs), TOTAL_BPS);
  assert.equal(dropped.length, 2);
});

test("zero, negative and non-finite weights do not poison the split", () => {
  for (const weight of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { legs } = normalizePicks([pick("NVDAc", weight), pick("AAPLc", 1)], TICKERS);
    assert.equal(sum(legs), TOTAL_BPS, `weight ${weight}`);
    for (const leg of legs) assert.ok(leg.bps >= MIN_LEG_BPS, `weight ${weight}: ${leg.bps}`);
  }
});

test("a lopsided split still leaves every leg above the floor", () => {
  const { legs } = normalizePicks(
    [pick("NVDAc", 1_000_000), pick("AAPLc", 1), pick("MSFTc", 1)],
    TICKERS,
  );
  assert.equal(sum(legs), TOTAL_BPS);
  for (const leg of legs) assert.ok(leg.bps >= MIN_LEG_BPS, `${leg.symbol} = ${leg.bps}`);
});

test("a single pick is a valid slate", () => {
  const { legs } = normalizePicks([pick("NVDAc", 1)], TICKERS);
  assert.deepEqual(legs, [{ symbol: "NVDAc", bps: TOTAL_BPS }]);
});

test("a proposal with nothing usable fails loudly rather than silently", () => {
  assert.throws(() => normalizePicks([pick("PLTRc", 1), pick("COINc", 1)], TICKERS), ComposeError);
});

test("every leg is a whole percent, so the editor reads 100 on screen", () => {
  const { legs } = normalizePicks(
    [pick("NVDAc", 7), pick("AAPLc", 5), pick("MSFTc", 3), pick("METAc", 2)],
    TICKERS,
  );
  for (const leg of legs) assert.equal(leg.bps % MIN_LEG_BPS, 0, `${leg.symbol} = ${leg.bps}`);
  assert.equal(sum(legs), TOTAL_BPS);
});
