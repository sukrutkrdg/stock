/**
 * Invariant tests for the slate maths.
 *
 *   npm test
 *
 * These are the rules the whole app leans on: a slate that does not sum to
 * 10,000 basis points cannot be priced, and an allocation whose parts do not
 * add back to the budget produces a swap that reverts. Both failures are
 * invisible in the UI until someone signs a transaction, which is exactly why
 * they are checked here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocate,
  canonicalize,
  decodeLegs,
  encodeLegs,
  equalWeights,
  rebalance,
  slateId,
  validateLegs,
  MIN_LEG_BPS,
  TOTAL_BPS,
  type Leg,
} from "../src/lib/slate.ts";

const SYMBOLS = ["AAPLc", "NVDAc", "MSFTc", "GOOGLc", "METAc", "AMZNc", "TSLAc", "COINc"];

const sum = (legs: Leg[]) => legs.reduce((total, leg) => total + leg.bps, 0);

test("equal weights always total exactly 100%", () => {
  for (let count = 1; count <= SYMBOLS.length; count += 1) {
    const legs = equalWeights(SYMBOLS.slice(0, count));
    assert.equal(sum(legs), TOTAL_BPS, `${count} legs`);
  }
});

test("equal weights are whole percents, so the panel adds to 100 on screen too", () => {
  for (let count = 1; count <= SYMBOLS.length; count += 1) {
    for (const leg of equalWeights(SYMBOLS.slice(0, count))) {
      assert.equal(leg.bps % MIN_LEG_BPS, 0, `${count} legs: ${leg.symbol} = ${leg.bps}`);
    }
  }
});

test("rebalance holds the total at 100% for every slider position", () => {
  for (let count = 2; count <= SYMBOLS.length; count += 1) {
    const start = equalWeights(SYMBOLS.slice(0, count));
    for (const edited of start) {
      for (let bps = MIN_LEG_BPS; bps <= TOTAL_BPS; bps += MIN_LEG_BPS) {
        const next = rebalance(start, edited.symbol, bps);
        assert.equal(sum(next), TOTAL_BPS, `${count} legs, ${edited.symbol} -> ${bps}`);
        for (const leg of next) {
          assert.ok(leg.bps >= MIN_LEG_BPS, `${leg.symbol} fell below the floor at ${bps}`);
        }
      }
    }
  }
});

test("rebalance gives the dragged leg what it asked for, within the floor", () => {
  const start = equalWeights(SYMBOLS.slice(0, 4));
  const next = rebalance(start, "NVDAc", 8000);
  assert.equal(next.find((leg) => leg.symbol === "NVDAc")!.bps, 8000);
});

test("rebalance clamps rather than starving the other legs", () => {
  const start = equalWeights(SYMBOLS.slice(0, 4));
  const next = rebalance(start, "NVDAc", TOTAL_BPS);
  assert.equal(sum(next), TOTAL_BPS);
  assert.equal(next.find((leg) => leg.symbol === "NVDAc")!.bps, TOTAL_BPS - MIN_LEG_BPS * 3);
});

test("rebalance keeps the caller's leg order so sliders do not jump mid-drag", () => {
  const start = equalWeights(SYMBOLS.slice(0, 5));
  const next = rebalance(start, start[2].symbol, 4000);
  assert.deepEqual(
    next.map((leg) => leg.symbol),
    start.map((leg) => leg.symbol),
  );
});

test("allocate splits a budget with nothing lost to rounding", () => {
  const legs = equalWeights(SYMBOLS.slice(0, 7)); // 7 does not divide 10,000 evenly
  for (const dollars of [5, 7, 13, 25, 99.99, 250, 1234.56]) {
    const budget = BigInt(Math.round(dollars * 1e6));
    const parts = allocate(legs, budget);
    const total = parts.reduce((acc, part) => acc + part.amount, 0n);
    assert.equal(total, budget, `$${dollars}`);
  }
});

test("slate ids are content addresses, independent of order", () => {
  const a: Leg[] = [
    { symbol: "NVDAc", bps: 6000 },
    { symbol: "AAPLc", bps: 4000 },
  ];
  const b: Leg[] = [
    { symbol: "AAPLc", bps: 4000 },
    { symbol: "NVDAc", bps: 6000 },
  ];
  assert.equal(slateId(a), slateId(b));
  assert.notEqual(slateId(a), slateId([{ symbol: "NVDAc", bps: 10_000 }]));
});

test("canonical order is stable", () => {
  const legs = canonicalize([
    { symbol: "AAPLc", bps: 3000 },
    { symbol: "NVDAc", bps: 5000 },
    { symbol: "MSFTc", bps: 2000 },
  ]);
  assert.deepEqual(
    legs.map((leg) => leg.symbol),
    ["NVDAc", "AAPLc", "MSFTc"],
  );
});

test("encode and decode round-trip", () => {
  const legs = equalWeights(["AAPLc", "NVDAc", "TSLAc"]);
  assert.deepEqual(decodeLegs(encodeLegs(legs)), canonicalize(legs));
});

test("validation rejects slates that cannot be bought", () => {
  assert.throws(() => validateLegs([]), /at least one/i);
  assert.throws(() => validateLegs([{ symbol: "AAPLc", bps: 5000 }]), /100%/);
  assert.throws(
    () =>
      validateLegs([
        { symbol: "AAPLc", bps: 5000 },
        { symbol: "AAPLc", bps: 5000 },
      ]),
    /twice/i,
  );
  assert.throws(
    () =>
      validateLegs([
        { symbol: "FAKEc", bps: 5000 },
        { symbol: "AAPLc", bps: 5000 },
      ]),
    /not a tokenized stock/i,
  );
  assert.throws(
    () =>
      validateLegs([
        { symbol: "AAPLc", bps: 50 },
        { symbol: "NVDAc", bps: 9950 },
      ]),
    /at least/i,
  );
});
