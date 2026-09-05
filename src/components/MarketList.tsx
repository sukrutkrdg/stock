"use client";

import { StockChip } from "./StockChip";
import { Skeleton } from "./ui";
import { formatUsd } from "@/lib/format";
import type { Ticker } from "@/lib/market";

export function MarketList({
  tickers,
  loading,
  onSelect,
  selected,
}: {
  tickers: Ticker[];
  loading?: boolean;
  onSelect?: (symbol: string) => void;
  selected?: Set<string>;
}) {
  if (loading) {
    return (
      <div className="space-y-px overflow-hidden rounded-2xl border border-line bg-surface">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-center gap-3 p-3.5">
            <Skeleton className="h-9 w-9 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
      {tickers.map((ticker) => {
        const isSelected = selected?.has(ticker.symbol) ?? false;
        const interactive = Boolean(onSelect);
        const disabled = interactive && !ticker.tradable && !isSelected;

        const content = (
          <>
            <StockChip symbol={ticker.symbol} />
            <div className="min-w-0 flex-1 text-left">
              <p className="truncate text-[15px] font-semibold leading-tight">{ticker.ticker}</p>
              <p className="truncate text-[12px] text-faint">{ticker.name}</p>
            </div>
            <div className="text-right">
              <p className="text-[15px] font-semibold tnum leading-tight">
                {ticker.price > 0 ? formatUsd(ticker.price) : "—"}
              </p>
              <p className="text-[11px] tnum text-faint">
                {!ticker.tradable ? "no liquidity" : ticker.stale ? "last close" : "live"}
              </p>
            </div>
            {interactive && (
              <span
                className={`ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                  isSelected ? "border-brand bg-brand text-white" : "border-line text-transparent"
                }`}
                aria-hidden
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6.2 5 8.7l4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}
          </>
        );

        return (
          <li key={ticker.symbol}>
            {interactive ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect?.(ticker.symbol)}
                aria-pressed={isSelected}
                className="flex w-full items-center gap-3 p-3.5 text-left transition active:bg-raised disabled:opacity-35"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 p-3.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
