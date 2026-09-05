import { createHash } from "node:crypto";
import { stockBySymbol, type Stock } from "./stocks";

/** Weights are basis points so they stay exact; a slate always sums to 10,000. */
export const TOTAL_BPS = 10_000;
export const MAX_LEGS = 8;
export const MIN_LEG_BPS = 100; // 1% — below this a leg rounds to dust on a small buy.

export type Leg = {
  symbol: string;
  bps: number;
};

export type Slate = {
  id: string;
  name: string;
  legs: Leg[];
  creatorAddress: string | null;
  creatorFid: number | null;
  creatorName: string | null;
  copies: number;
  createdAt: string;
};

export type SlateDraft = Pick<Slate, "name" | "legs"> &
  Partial<Pick<Slate, "creatorAddress" | "creatorFid" | "creatorName">>;

export class SlateError extends Error {}

/**
 * Canonical ordering: descending weight, then symbol. Two people who pick the
 * same companies at the same weights produce byte-identical canonical forms,
 * which is what makes `slateId` a stable content address.
 */
export function canonicalize(legs: Leg[]): Leg[] {
  return [...legs].sort((a, b) => b.bps - a.bps || a.symbol.localeCompare(b.symbol));
}

/**
 * Content address for a composition.
 *
 * Deliberately derived from the legs alone — not the name or the creator — so
 * that a copied slate resolves to the same row. That is what lets the app say
 * "412 people hold this" instead of scattering identical slates across the feed.
 */
export function slateId(legs: Leg[]): string {
  const canonical = canonicalize(legs)
    .map((leg) => `${leg.symbol}:${leg.bps}`)
    .join(",");
  return createHash("sha256").update(canonical).digest("base64url").slice(0, 12);
}

/** Rejects anything a slate page could not honestly render or price. */
export function validateLegs(legs: Leg[]): Leg[] {
  if (!Array.isArray(legs) || legs.length === 0) {
    throw new SlateError("A slate needs at least one position.");
  }
  if (legs.length > MAX_LEGS) {
    throw new SlateError(`A slate can hold at most ${MAX_LEGS} positions.`);
  }

  const seen = new Set<string>();
  const cleaned: Leg[] = [];

  for (const leg of legs) {
    const stock = stockBySymbol(String(leg?.symbol ?? ""));
    if (!stock) throw new SlateError(`${leg?.symbol} is not a tokenized stock on Base.`);
    if (seen.has(stock.symbol)) throw new SlateError(`${stock.symbol} appears twice.`);
    seen.add(stock.symbol);

    const bps = Math.round(Number(leg.bps));
    if (!Number.isFinite(bps) || bps < MIN_LEG_BPS) {
      throw new SlateError(`${stock.symbol} must be at least ${MIN_LEG_BPS / 100}%.`);
    }
    cleaned.push({ symbol: stock.symbol, bps });
  }

  const total = cleaned.reduce((sum, leg) => sum + leg.bps, 0);
  if (total !== TOTAL_BPS) {
    throw new SlateError(`Weights must add up to 100% (currently ${(total / 100).toFixed(1)}%).`);
  }

  return canonicalize(cleaned);
}

export function validateName(raw: string): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new SlateError("Give the slate a name.");
  if (name.length > 32) throw new SlateError("Names are limited to 32 characters.");
  return name;
}

/**
 * Distribute `total` basis points across `shares` in whole percentage points.
 *
 * Largest-remainder apportionment: floor every share to a whole percent, then
 * hand the leftover percents to whoever was rounded down hardest. Two
 * properties come out of it, and the editor depends on both — the parts sum to
 * `total` exactly, and every part is a round number, so the panel reads
 * "35% · 25% · 20% · 20%" and adds to 100 on screen as well as in the maths.
 *
 * Proportional rounding without this step is what produces a slate that says
 * 100.1%: three legs of 6.15% each display as 6.2%.
 */
function apportion(weights: number[], total: number, floor: number): number[] {
  const count = weights.length;
  if (count === 0) return [];

  const sum = weights.reduce((a, b) => a + b, 0);
  const step = MIN_LEG_BPS;
  const steps = total / step;

  const exact = weights.map((weight) => (sum > 0 ? (weight / sum) * steps : steps / count));
  const floorSteps = Math.max(1, Math.round(floor / step));

  const base = exact.map((value) => Math.max(floorSteps, Math.floor(value)));
  let leftover = steps - base.reduce((a, b) => a + b, 0);

  // Ranked by how much each share lost to the floor, so the extra percents land
  // where they were most deserved rather than on whoever happens to be first.
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; leftover > 0; i = (i + 1) % order.length) {
    base[order[i].index] += 1;
    leftover -= 1;
  }
  // If the floors overshot (many tiny legs), claw back from the largest.
  while (leftover < 0) {
    const largest = base.indexOf(Math.max(...base));
    if (base[largest] <= floorSteps) break;
    base[largest] -= 1;
    leftover += 1;
  }

  return base.map((value) => value * step);
}

/** Equal weights that still add to exactly 100%: 3 legs become 34/33/33. */
export function equalWeights(symbols: string[]): Leg[] {
  const shares = apportion(symbols.map(() => 1), TOTAL_BPS, MIN_LEG_BPS);
  return symbols.map((symbol, index) => ({ symbol, bps: shares[index] }));
}

/**
 * Rebalance after the user drags one slider.
 *
 * The edited leg keeps exactly what was asked for; the others absorb the
 * difference in proportion to what they already held. The total is re-derived
 * rather than patched, so the slate is never briefly invalid and there is no
 * "normalize" button to forget.
 */
export function rebalance(legs: Leg[], editedSymbol: string, editedBps: number): Leg[] {
  const others = legs.filter((leg) => leg.symbol !== editedSymbol);
  if (others.length === 0) return [{ symbol: editedSymbol, bps: TOTAL_BPS }];

  const maxForOne = TOTAL_BPS - MIN_LEG_BPS * others.length;
  const snapped = Math.round(editedBps / MIN_LEG_BPS) * MIN_LEG_BPS;
  const clamped = Math.max(MIN_LEG_BPS, Math.min(maxForOne, snapped));

  const shares = apportion(
    others.map((leg) => leg.bps),
    TOTAL_BPS - clamped,
    MIN_LEG_BPS,
  );

  const next = new Map<string, number>([[editedSymbol, clamped]]);
  others.forEach((leg, index) => next.set(leg.symbol, shares[index]));

  // Preserve the caller's ordering so sliders do not jump around mid-drag.
  return legs.map((leg) => ({ symbol: leg.symbol, bps: next.get(leg.symbol)! }));
}

export type Allocation = {
  stock: Stock;
  bps: number;
  /** USDC to spend on this leg, in base units (6 decimals). */
  amount: bigint;
};

/**
 * Split a USDC budget across a slate's legs.
 *
 * Integer math throughout: the per-leg amounts are floored and the leftover
 * base units are handed to the largest leg, so the parts always add back up to
 * `budget` exactly. A swap that is short by a few micro-USDC is a failed
 * transaction, not a rounding curiosity.
 */
export function allocate(legs: Leg[], budget: bigint): Allocation[] {
  const allocations = canonicalize(legs).map((leg) => ({
    stock: stockBySymbol(leg.symbol)!,
    bps: leg.bps,
    amount: (budget * BigInt(leg.bps)) / BigInt(TOTAL_BPS),
  }));

  const assigned = allocations.reduce((sum, a) => sum + a.amount, 0n);
  if (assigned < budget && allocations.length > 0) {
    allocations[0].amount += budget - assigned;
  }
  return allocations;
}

/**
 * Compact URL form: `AAPLc.2500-NVDAc.7500`.
 *
 * Lets a slate link render before it has ever been written to the database, and
 * gives the app a working share URL if a write fails.
 */
export function encodeLegs(legs: Leg[]): string {
  return canonicalize(legs)
    .map((leg) => `${leg.symbol}.${leg.bps}`)
    .join("-");
}

export function decodeLegs(encoded: string): Leg[] {
  const legs = encoded.split("-").map((part) => {
    const [symbol, bps] = part.split(".");
    return { symbol, bps: Number(bps) };
  });
  return validateLegs(legs);
}
