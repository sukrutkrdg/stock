"use client";

import Link from "next/link";
import { AllocationRing } from "./AllocationRing";
import { StockChip } from "./StockChip";
import { formatUsd } from "@/lib/format";
import type { Slate } from "@/lib/slate";
import type { Ticker } from "@/lib/market";

/**
 * A slate in the feed.
 *
 * The headline number counts wallets that have bought this basket, ever — not
 * wallets holding it now. Stock tokens are fungible, so nothing onchain says
 * which basket a balance came from, and a wallet that sells cannot be told
 * apart from one that never bought. Calling that "holders" would be a claim the
 * data cannot support, so it says "bought".
 *
 * Performance since inception is deliberately absent: without a per-wallet cost
 * basis it would be a backtest dressed up as a track record.
 */
export function SlateCard({
  slate,
  tickers,
}: {
  slate: Slate;
  tickers: Map<string, Ticker>;
}) {
  const priced = slate.legs.every((leg) => (tickers.get(leg.symbol)?.price ?? 0) > 0);
  const unitPrice = slate.legs.reduce((sum, leg) => {
    const price = tickers.get(leg.symbol)?.price ?? 0;
    return sum + (leg.bps / 10_000) * price;
  }, 0);

  return (
    <Link
      href={`/s/${slate.id}`}
      className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 transition active:scale-[0.99]"
    >
      <AllocationRing legs={slate.legs} size={64} thickness={8}>
        <span className="text-[11px] font-semibold tabular-nums text-muted">
          {slate.legs.length}
        </span>
      </AllocationRing>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-[15px] font-semibold">{slate.name}</h3>
          <span className="shrink-0 text-[12px] tabular-nums text-faint">
            {slate.copies} bought
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          {slate.legs.slice(0, 5).map((leg) => (
            <StockChip key={leg.symbol} symbol={leg.symbol} size="sm" />
          ))}
          {slate.legs.length > 5 && (
            <span className="text-[11px] text-faint">+{slate.legs.length - 5}</span>
          )}
        </div>

        <p className="mt-2 text-[12px] text-faint tnum">
          {priced ? `${formatUsd(unitPrice)} blended · ` : ""}
          {slate.creatorName ? `by ${slate.creatorName}` : "community slate"}
        </p>
      </div>
    </Link>
  );
}
