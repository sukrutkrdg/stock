import { parseAbi } from "viem";

/**
 * B20 Asset ABI — the subset Slate reads or writes.
 *
 * B20 is Base's native token standard, implemented as protocol precompiles
 * rather than deployed contracts. Every standard ERC-20 selector behaves
 * exactly as it does elsewhere; the Asset variant layers a *multiplier* on top.
 *
 * Function selectors below were checked against the generated reference at
 * https://docs.base.org/specifications/b20/reference/interfaces/ib20-asset
 * by `scripts/verify-onchain.ts`.
 */
export const b20AssetAbi = parseAbi([
  // ERC-20 surface — identical selectors and semantics.
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",

  // Asset-variant multiplier surface.
  "function WAD_PRECISION() view returns (uint256)",
  "function multiplier() view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function scaledBalanceOf(address account) view returns (uint256)",
  "function toScaledBalance(uint256 rawAmount) view returns (uint256)",
  "function toRawBalance(uint256 scaledAmount) view returns (uint256)",
  "function totalSupplyUI() view returns (uint256)",
  "function extraMetadata(string key) view returns (string)",
]);

/** Fixed-point precision the B20 multiplier is scaled to. */
export const WAD = 10n ** 18n;

/**
 * A pending, ERC-8056-style multiplier change. Scheduled updates give holders
 * advance notice of a corporate action; `updateMultiplier` can also fire an
 * instant one as an emergency failsafe, in which case nothing is ever pending.
 */
export type PendingMultiplier = {
  next: bigint;
  effectiveAt: number;
};

/** raw units -> multiplier-adjusted units, matching `toScaledBalance` onchain. */
export function toScaled(raw: bigint, multiplier: bigint): bigint {
  return (raw * multiplier) / WAD;
}

/** multiplier-adjusted units -> raw units, matching `toRawBalance` onchain. */
export function toRaw(scaled: bigint, multiplier: bigint): bigint {
  if (multiplier === 0n) return 0n;
  return (scaled * WAD) / multiplier;
}

/**
 * How many underlying shares a raw token balance currently represents.
 *
 * One B20 token does not permanently equal one share: a stock split or other
 * corporate action moves the multiplier without touching raw balances. Every
 * share figure Slate shows goes through here.
 */
export function sharesFromRaw(raw: bigint, multiplier: bigint, decimals: number): number {
  return Number(toScaled(raw, multiplier)) / 10 ** decimals;
}
