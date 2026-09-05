"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StockChip } from "./StockChip";
import { Banner, Button, Spinner } from "./ui";
import { useSellPositions } from "@/hooks/useSellPositions";
import { formatPercent, formatShares, formatUsd } from "@/lib/format";
import { SELL_ALL_BPS } from "@/lib/sell";
import type { Position } from "@/app/api/portfolio/route";

const PORTIONS = [
  { bps: 2_500, label: "25%" },
  { bps: 5_000, label: "50%" },
  { bps: 7_500, label: "75%" },
  { bps: SELL_ALL_BPS, label: "All" },
];

/**
 * Sell positions back to USDC.
 *
 * Deliberately keyed on positions, not on slates. A wallet holds tokens, not
 * baskets — buy the same stock through two slates and the tokens are one
 * fungible balance, so "sell this basket" has no honest answer about which
 * tokens leave. Selling what is actually held avoids inventing an accounting
 * the chain does not have.
 */
export function SellSheet({
  positions,
  preselected,
  onClose,
}: {
  positions: Position[];
  preselected?: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const sale = useSellPositions();

  const [selected, setSelected] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (preselected?.length ? preselected : positions.map((p) => p.symbol)).map((symbol) => [
        symbol,
        SELL_ALL_BPS,
      ]),
    ),
  );

  const chosen = useMemo(
    () =>
      Object.entries(selected)
        .filter(([, bps]) => bps > 0)
        .map(([symbol, bps]) => ({ symbol, bps })),
    [selected],
  );

  const estimated = useMemo(
    () =>
      chosen.reduce((sum, pick) => {
        const position = positions.find((p) => p.symbol === pick.symbol);
        return sum + (position ? (position.value * pick.bps) / SELL_ALL_BPS : 0);
      }, 0),
    [chosen, positions],
  );

  const { stage, quote, error, txHash } = sale;
  const busy = stage === "quoting" || stage === "signing" || stage === "confirming";

  function setPortion(symbol: string, bps: number) {
    sale.reset();
    setSelected((current) => ({ ...current, [symbol]: current[symbol] === bps ? 0 : bps }));
  }

  async function onPreview() {
    try {
      await sale.preview(chosen);
    } catch {
      // Surfaced by the hook.
    }
  }

  async function onSell() {
    if (!quote) return;
    try {
      await sale.sell(quote);
      // Balances and positions both moved; let them refetch rather than
      // guessing at the new numbers.
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
    } catch {
      // Surfaced by the hook.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        className="relative mx-auto max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        {stage === "done" ? (
          <div className="space-y-4 text-center">
            <h2 className="text-[19px] font-bold">Sold</h2>
            <p className="text-[14px] leading-snug text-muted">
              {quote ? formatUsd(Number(quote.proceedsUsdc) / 1e6) : "Your proceeds"} in USDC is
              back in your wallet.
            </p>
            {txHash && (
              <a
                href={`https://basescan.org/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[13px] font-semibold text-brand"
              >
                View on Basescan
              </a>
            )}
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <h2 className="text-[19px] font-bold leading-tight">Sell positions</h2>
            <p className="mt-1 text-[13px] leading-snug text-muted">
              Everything sells back to USDC in one signature.
            </p>

            <ul className="mt-4 divide-y divide-line-soft overflow-hidden rounded-2xl border border-line">
              {positions.map((position) => {
                const bps = selected[position.symbol] ?? 0;
                return (
                  <li key={position.symbol} className="p-3.5">
                    <div className="flex items-center gap-3">
                      <StockChip symbol={position.symbol} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold leading-tight">
                          {position.ticker}
                        </p>
                        <p className="truncate text-[11px] tnum text-faint">
                          {formatShares(position.shares)} sh · {formatUsd(position.value)}
                        </p>
                      </div>
                      <span className="text-[13px] font-semibold tnum">
                        {bps > 0 ? formatUsd((position.value * bps) / SELL_ALL_BPS) : "—"}
                      </span>
                    </div>

                    <div className="mt-2.5 flex gap-1.5">
                      {PORTIONS.map((portion) => (
                        <button
                          key={portion.bps}
                          type="button"
                          onClick={() => setPortion(position.symbol, portion.bps)}
                          className={`flex-1 rounded-lg border py-2 text-[12px] font-semibold transition ${
                            bps === portion.bps
                              ? "border-brand bg-brand-soft text-text"
                              : "border-line text-muted"
                          }`}
                        >
                          {portion.label}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>

            {quote && (
              <div className="mt-4 divide-y divide-line-soft rounded-2xl border border-line">
                {quote.legs.map((leg) => (
                  <div
                    key={leg.symbol}
                    className="flex items-center justify-between p-3.5 text-[13px]"
                  >
                    <span className="font-medium">
                      {leg.ticker}
                      {leg.closesPosition && (
                        <span className="ml-2 text-[11px] text-faint">closes</span>
                      )}
                    </span>
                    <span className="tnum text-muted">
                      {formatShares(leg.shares)} sh → {formatUsd(Number(leg.buyUsdc) / 1e6)}
                      <span
                        className={`ml-2 ${leg.premiumPercent < -1 ? "text-down" : "text-faint"}`}
                      >
                        {formatPercent(leg.premiumPercent, true)}
                      </span>
                    </span>
                  </div>
                ))}
                {quote.skipped.length > 0 && (
                  <div className="p-3.5 text-[12px] text-faint">
                    Skipped:{" "}
                    {quote.skipped.map((s) => `${s.symbol} (${s.reason})`).join(", ")}
                  </div>
                )}
                <div className="flex items-center justify-between p-3.5 text-[13px]">
                  <span className="font-medium">You receive</span>
                  <span className="tnum font-semibold">
                    {formatUsd(Number(quote.proceedsUsdc) / 1e6)}
                  </span>
                </div>
                <div className="p-3.5 text-[11px] leading-relaxed text-faint">
                  {quote.legs.length} approval{quote.legs.length === 1 ? "" : "s"} plus{" "}
                  {quote.legs.length} swap{quote.legs.length === 1 ? "" : "s"}, sent as one batch
                  you sign once. Selling needs an approval per stock because each is its own
                  token. Percentages compare the route against the Chainlink feed;{" "}
                  {(quote.slippageBps / 100).toFixed(1)}% slippage is encoded into the calldata.
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4">
                <Banner tone="error">{error}</Banner>
              </div>
            )}

            {stage === "confirming" && (
              <p className="mt-4 flex items-center gap-2 text-[13px] text-faint">
                <Spinner /> Waiting for Base
              </p>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              {quote ? (
                <Button className="flex-1" onClick={onSell} loading={busy}>
                  {stage === "signing"
                    ? "Confirm in your wallet"
                    : stage === "confirming"
                      ? "Confirming…"
                      : `Sell for ${formatUsd(Number(quote.proceedsUsdc) / 1e6)}`}
                </Button>
              ) : (
                <Button
                  className="flex-1"
                  onClick={onPreview}
                  loading={stage === "quoting"}
                  disabled={chosen.length === 0}
                >
                  {chosen.length === 0
                    ? "Pick something to sell"
                    : stage === "quoting"
                      ? "Pricing…"
                      : `Preview ${formatUsd(estimated)}`}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
