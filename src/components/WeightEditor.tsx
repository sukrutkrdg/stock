"use client";

import { StockChip } from "./StockChip";
import { stockBySymbol } from "@/lib/stocks";
import { MIN_LEG_BPS, type Leg } from "@/lib/slate";
import { formatWeight } from "@/lib/format";

/**
 * Weight sliders.
 *
 * Moving one slider redistributes the rest proportionally, so the total is
 * always exactly 100% — there is no "normalize" button to forget and no way to
 * reach an unbuyable state. The lock is the invariant; the user only ever picks
 * emphasis.
 */
export function WeightEditor({
  legs,
  onChange,
  onRemove,
  notes,
}: {
  legs: Leg[];
  onChange: (symbol: string, bps: number) => void;
  onRemove: (symbol: string) => void;
  /** One line per symbol on why it is in the basket, when composed. */
  notes?: Record<string, string>;
}) {
  const maxForOne = 10_000 - MIN_LEG_BPS * (legs.length - 1);

  return (
    <ul className="divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
      {legs.map((leg) => {
        const stock = stockBySymbol(leg.symbol);
        return (
          <li key={leg.symbol} className="p-3.5">
            <div className="flex items-center gap-3">
              <StockChip symbol={leg.symbol} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold leading-tight">{stock?.ticker}</p>
                <p className="truncate text-[11px] text-faint">
                  {notes?.[leg.symbol] || stock?.name}
                </p>
              </div>
              <span className="w-14 text-right text-[15px] font-semibold tnum">
                {formatWeight(leg.bps)}
              </span>
              <button
                type="button"
                onClick={() => onRemove(leg.symbol)}
                aria-label={`Remove ${stock?.ticker ?? leg.symbol}`}
                disabled={legs.length <= 1}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-faint transition hover:text-down disabled:opacity-25"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path
                    d="M3.5 3.5 10.5 10.5M10.5 3.5 3.5 10.5"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <input
              type="range"
              className="mt-3 w-full"
              min={MIN_LEG_BPS}
              max={maxForOne}
              step={100}
              value={leg.bps}
              disabled={legs.length <= 1}
              aria-label={`${stock?.ticker ?? leg.symbol} weight`}
              onChange={(event) => onChange(leg.symbol, Number(event.target.value))}
            />
          </li>
        );
      })}
    </ul>
  );
}
