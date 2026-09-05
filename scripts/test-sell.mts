/**
 * Invariant tests for sale planning.
 *
 *   npm run test:sell
 *
 * A buy that miscounts costs the user a rounding error. A sale that miscounts
 * either reverts the whole batch — asking to move more than the wallet holds —
 * or silently leaves a remainder on a position the user asked to close. Both
 * happen entirely inside this arithmetic, so it is checked here rather than
 * discovered onchain.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planSale,
  rawAmountFor,
  sharesOf,
  SellError,
  SELL_ALL_BPS,
  MIN_SELL_USD,
  type Holding,
} from "../src/lib/sell.ts";
import { WAD } from "../src/lib/b20.ts";

const holding = (raw: bigint, price = 100, multiplier = WAD, decimals = 8): Holding => ({
  raw,
  decimals,
  multiplier,
  price,
});

/** 1.0 token at 8 decimals. */
const ONE = 100_000_000n;

test("selling everything moves the exact balance, never a computed fraction", () => {
  for (const balance of [1n, 7n, ONE, ONE * 3n + 1n, 123_456_789n, 2n ** 70n]) {
    assert.equal(rawAmountFor(balance, SELL_ALL_BPS), balance, `balance ${balance}`);
  }
});

test("a partial sale never exceeds the balance", () => {
  const balance = 123_456_789n;
  for (let bps = 1; bps <= SELL_ALL_BPS; bps += 7) {
    const amount = rawAmountFor(balance, bps);
    assert.ok(amount <= balance, `${bps}bps -> ${amount} > ${balance}`);
  }
});

test("partial sales are monotonic in the portion asked for", () => {
  const balance = 987_654_321n;
  let previous = 0n;
  for (let bps = 100; bps <= SELL_ALL_BPS; bps += 100) {
    const amount = rawAmountFor(balance, bps);
    assert.ok(amount >= previous, `${bps}bps went backwards`);
    previous = amount;
  }
});

test("selling half twice never oversells the position", () => {
  const balance = 100_000_001n;
  const first = rawAmountFor(balance, 5_000);
  const remaining = balance - first;
  const second = rawAmountFor(remaining, 5_000);
  assert.ok(first + second <= balance);
});

test("zero and negative portions move nothing", () => {
  assert.equal(rawAmountFor(ONE, 0), 0n);
  assert.equal(rawAmountFor(ONE, -500), 0n);
});

test("a plan closes a position only when the whole balance is moving", () => {
  const holdings = new Map([["NVDAc", holding(ONE)]]);

  const all = planSale([{ symbol: "NVDAc", bps: SELL_ALL_BPS }], holdings);
  assert.equal(all.lots[0].rawAmount, ONE);
  assert.equal(all.lots[0].closesPosition, true);

  const half = planSale([{ symbol: "NVDAc", bps: 5_000 }], holdings);
  assert.equal(half.lots[0].rawAmount, ONE / 2n);
  assert.equal(half.lots[0].closesPosition, false);
});

test("a portion above 100% is clamped, not multiplied", () => {
  const holdings = new Map([["NVDAc", holding(ONE)]]);
  const plan = planSale([{ symbol: "NVDAc", bps: 50_000 }], holdings);
  assert.equal(plan.lots[0].rawAmount, ONE);
});

test("share counts apply the multiplier; raw amounts never do", () => {
  // A 2:1 split: the raw balance is unchanged, each token is worth two shares.
  const split = holding(ONE, 100, WAD * 2n);
  assert.equal(sharesOf(split), 2);

  const plan = planSale([{ symbol: "NVDAc", bps: SELL_ALL_BPS }], new Map([["NVDAc", split]]));
  assert.equal(plan.lots[0].rawAmount, ONE, "raw amount must ignore the multiplier");
  assert.equal(plan.lots[0].shares, 2, "shares must apply it");
});

test("a shrinking multiplier does not inflate what is sold", () => {
  const reverse = holding(ONE, 100, WAD / 2n);
  const plan = planSale([{ symbol: "NVDAc", bps: SELL_ALL_BPS }], new Map([["NVDAc", reverse]]));
  assert.equal(plan.lots[0].rawAmount, ONE);
  assert.equal(plan.lots[0].shares, 0.5);
});

test("positions that cannot be sold are reported, not dropped in silence", () => {
  const holdings = new Map([
    ["NVDAc", holding(ONE)],
    ["MSFTc", holding(0n)],
  ]);
  const plan = planSale(
    [
      { symbol: "NVDAc", bps: SELL_ALL_BPS },
      { symbol: "MSFTc", bps: SELL_ALL_BPS },
      { symbol: "PLTRc", bps: SELL_ALL_BPS },
    ],
    holdings,
  );
  assert.equal(plan.lots.length, 1);
  assert.equal(plan.skipped.length, 2);
  assert.match(plan.skipped.find((s) => s.symbol === "MSFT")!.reason, /nothing held/);
  assert.match(plan.skipped.find((s) => s.symbol === "PLTRc")!.reason, /not a tokenized stock/);
});

test("dust is skipped rather than sent to a route that will not fill", () => {
  // 0.000001 tokens at $100 is a hundredth of a cent.
  const plan = () => planSale([{ symbol: "NVDAc", bps: SELL_ALL_BPS }], new Map([["NVDAc", holding(100n)]]));
  assert.throws(plan, SellError);
});

test("the dust floor is applied on value, not on token count", () => {
  // A tiny raw balance of an expensive stock still clears the floor.
  const expensive = holding(ONE / 50n, 2000); // 0.02 tokens at $2,000 = $40
  const plan = planSale([{ symbol: "SNDKc", bps: SELL_ALL_BPS }], new Map([["SNDKc", expensive]]));
  assert.ok(plan.estimatedUsd > MIN_SELL_USD);
  assert.equal(plan.lots.length, 1);
});

test("duplicate intents collapse instead of selling twice", () => {
  const holdings = new Map([["NVDAc", holding(ONE)]]);
  const plan = planSale(
    [
      { symbol: "NVDAc", bps: SELL_ALL_BPS },
      { symbol: "NVDAc", bps: SELL_ALL_BPS },
    ],
    holdings,
  );
  assert.equal(plan.lots.length, 1);
  assert.equal(plan.lots[0].rawAmount, ONE);
});

test("an empty or fully unsellable request fails loudly", () => {
  assert.throws(() => planSale([], new Map()), SellError);
  assert.throws(
    () => planSale([{ symbol: "NVDAc", bps: SELL_ALL_BPS }], new Map()),
    SellError,
  );
});

test("estimated proceeds sum the legs", () => {
  const holdings = new Map([
    ["NVDAc", holding(ONE, 200)],
    ["AAPLc", holding(ONE * 2n, 300)],
  ]);
  const plan = planSale(
    [
      { symbol: "NVDAc", bps: SELL_ALL_BPS },
      { symbol: "AAPLc", bps: 5_000 },
    ],
    holdings,
  );
  // 1 token at $200 + 1 token (half of two) at $300
  assert.equal(plan.estimatedUsd, 500);
});
