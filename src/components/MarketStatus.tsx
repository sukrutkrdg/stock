"use client";

import { formatAge } from "@/lib/format";
import type { Market } from "@/lib/market";

/**
 * Says out loud what the feed is doing.
 *
 * Tokenized stocks trade against Chainlink feeds that run 24/5, so on a weekend
 * the last round is legitimately hours old. Showing a stale price with no label
 * is the failure mode worth designing against — the number looks live, and a
 * user sizes a trade against it.
 */
export function MarketStatus({ market }: { market: Market | undefined }) {
  if (!market) return null;

  const freshest = market.tickers.reduce(
    (min, ticker) => Math.min(min, ticker.ageSeconds),
    Number.MAX_SAFE_INTEGER,
  );

  if (market.marketClosed) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-warn" />
        <p className="text-[13px] leading-snug text-warn">
          <span className="font-semibold">Market closed.</span>{" "}
          <span className="opacity-80">
            Showing the last round, {formatAge(freshest)}. Buys resume when the feeds do.
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-1 text-[12px] text-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-up" />
      Live · Chainlink, updated {formatAge(freshest)}
    </div>
  );
}
