"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSlatesFor, useUnlistSlate } from "@/hooks/useSlates";
import { useMarket, tickerMap } from "@/hooks/useMarket";
import { SellSheet } from "@/components/SellSheet";
import { SlateCard } from "@/components/SlateCard";
import { StockChip } from "@/components/StockChip";
import { Banner, Button, Card, SectionTitle, Skeleton } from "@/components/ui";
import { useWallet } from "@/hooks/useWallet";
import { formatShares, formatUsd, shortAddress } from "@/lib/format";
import type { DcaPlan } from "@/lib/repo";

export default function YouPage() {
  const { address, isConnected, isConnecting, isInMiniApp, stuck, connect, disconnect, connectError } =
    useWallet();
  const { setMiniAppReady, isMiniAppReady } = useMiniKit();
  const portfolio = usePortfolio();
  const market = useMarket();
  const held = useSlatesFor({ holder: address });
  const created = useSlatesFor({ creator: address });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isMiniAppReady) void setMiniAppReady();
  }, [isMiniAppReady, setMiniAppReady]);

  const plans = useQuery({
    queryKey: ["dca", address],
    enabled: Boolean(address),
    queryFn: async (): Promise<DcaPlan[]> => {
      const response = await fetch(`/api/dca?owner=${encodeURIComponent(address!)}`);
      // Throwing rather than returning [] — a failed read used to render as
      // "no schedules", which is indistinguishable from having none.
      if (!response.ok) throw new Error("Could not load your schedules.");
      return (await response.json()).plans ?? [];
    },
  });

  /**
   * Cancelling used to be a fire-and-forget fetch whose result was discarded:
   * no status check, no error state, no pending state. A request that failed —
   * or a tap that missed the button entirely — looked exactly like success, so
   * the schedule stayed on screen with nothing to explain why.
   */
  const cancelPlan = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(
        `/api/dca?owner=${encodeURIComponent(address!)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not cancel the schedule.");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dca", address] }),
  });

  const unlist = useUnlistSlate();
  const [selling, setSelling] = useState<string[] | null>(null);

  const tickers = tickerMap(market.data);

  if (!isConnected) {
    return (
      <div className="px-4 pt-6">
        <h1 className="text-[24px] font-bold tracking-tight">You</h1>
        <p className="mt-2 text-[14px] leading-snug text-muted">
          {isInMiniApp
            ? "Connecting your Base Account…"
            : "Connect a wallet to see the tokenized stocks you hold and the slates you have bought."}
        </p>

        {/* Inside Base App the connection arrives on its own, so offering a
            button there would ask the user to do something already happening. */}
        {!isInMiniApp && (
          <Button
            className="mt-5 w-full"
            onClick={() => void connect().catch(() => {})}
            loading={isConnecting}
          >
            {isConnecting ? "Connecting…" : "Connect a wallet"}
          </Button>
        )}

        {(connectError || stuck) && (
          <div className="mt-4 space-y-3">
            <Banner tone="error">
              {stuck
                ? "A wallet session is half-open, which is why connecting keeps failing."
                : connectError}
            </Banner>
            {/* Without this a wedged session can only be cleared by wiping site
                data — the connect button would keep hitting the same wall. */}
            <Button variant="secondary" className="w-full" onClick={() => void disconnect()}>
              Reset the wallet session
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pb-6">
      <header className="px-4 pt-6">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">You</h1>
        <p className="mt-1 text-[13px] tnum text-faint">{shortAddress(address!)}</p>
      </header>

      <div className="px-4 pt-5">
        <Card className="p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-faint">
            Stock value
          </p>
          {portfolio.isLoading ? (
            <Skeleton className="mt-2 h-9 w-40" />
          ) : (
            <p className="mt-1 text-[32px] font-bold leading-none tnum">
              {formatUsd(portfolio.data?.totalValue ?? 0)}
            </p>
          )}
          <p className="mt-2 text-[12px] tnum text-faint">
            {formatUsd(portfolio.data?.usdc ?? 0)} USDC available
            {portfolio.data?.marketClosed ? " · market closed, last-close prices" : ""}
          </p>
        </Card>
      </div>

      {(portfolio.data?.positions.length ?? 0) > 0 && (
        <>
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setSelling([])}
                className="px-2 py-1 text-[13px] font-semibold text-brand"
              >
                Sell
              </button>
            }
          >
            Positions
          </SectionTitle>
          <ul className="mx-4 divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
            {portfolio.data!.positions.map((position) => (
              <li key={position.symbol} className="flex items-center gap-3 p-3.5">
                <StockChip symbol={position.symbol} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold leading-tight">
                    {position.ticker}
                  </p>
                  <p className="truncate text-[12px] tnum text-faint">
                    {formatShares(position.shares)} shares · {formatUsd(position.price)}
                  </p>
                </div>
                <p className="text-[15px] font-semibold tnum">{formatUsd(position.value)}</p>
                <button
                  type="button"
                  onClick={() => setSelling([position.symbol])}
                  aria-label={`Sell ${position.ticker}`}
                  className="-mr-1 shrink-0 px-3 py-2.5 text-[13px] text-muted transition hover:text-text"
                >
                  Sell
                </button>
              </li>
            ))}
          </ul>
          <p className="px-5 pt-2 text-[11px] leading-relaxed text-faint">
            Share counts apply the current B20 multiplier, so a split or other corporate action is
            already reflected here.
          </p>
        </>
      )}

      {(plans.data?.length ?? 0) > 0 && (
        <>
          <SectionTitle>Schedules</SectionTitle>
          <ul className="mx-4 divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
            {plans.data!.map((plan) => (
              <li key={plan.id} className="flex items-center gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold leading-tight tnum">
                    {formatUsd(Number(plan.amountUsdc))} every{" "}
                    {plan.periodDays === 1 ? "day" : `${plan.periodDays} days`}
                  </p>
                  <p className="mt-0.5 text-[12px] text-faint">
                    Next reminder {new Date(plan.nextChargeAt).toLocaleDateString()}
                    {plan.charges > 0 ? ` · ${plan.charges} sent` : ""}
                  </p>
                </div>
                {/* Both controls carry real padding so they clear the 44px
                    minimum tap target. The previous Cancel was 41x20px sitting
                    12px from this link, which is how a cancel becomes a
                    navigation. */}
                <Link
                  href={`/s/${plan.slateId}`}
                  className="shrink-0 px-3 py-2.5 text-[13px] font-semibold text-brand"
                >
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => cancelPlan.mutate(plan.id)}
                  disabled={cancelPlan.isPending}
                  aria-label={`Cancel the ${formatUsd(Number(plan.amountUsdc))} schedule`}
                  className="-mr-1 shrink-0 px-3 py-2.5 text-[13px] text-muted transition hover:text-down disabled:opacity-40"
                >
                  {cancelPlan.isPending && cancelPlan.variables === plan.id
                    ? "Cancelling…"
                    : "Cancel"}
                </button>
              </li>
            ))}
          </ul>
          {(cancelPlan.error || plans.error) && (
            <div className="px-4 pt-2">
              <Banner tone="error">
                {(cancelPlan.error ?? plans.error)?.message}
              </Banner>
            </div>
          )}
        </>
      )}

      {(held.data?.length ?? 0) > 0 && (
        <>
          <SectionTitle>Slates you hold</SectionTitle>
          <div className="space-y-2 px-4">
            {held.data!.map((slate) => (
              <SlateCard key={slate.id} slate={slate} tickers={tickers} />
            ))}
          </div>
        </>
      )}

      {(created.data?.length ?? 0) > 0 && (
        <>
          <SectionTitle>Slates you made</SectionTitle>
          <div className="space-y-2 px-4">
            {created.data!.map((slate) => (
              <div key={slate.id}>
                <SlateCard slate={slate} tickers={tickers} />
                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-[11px] text-faint">
                    {slate.hidden ? "Unlisted — reachable by link only" : "In the public feed"}
                  </span>
                  {!slate.hidden && (
                    <button
                      type="button"
                      onClick={() => unlist.mutate(slate.id)}
                      disabled={unlist.isPending}
                      aria-label={`Unlist ${slate.name}`}
                      className="-mr-1 px-3 py-2 text-[12px] text-muted transition hover:text-down disabled:opacity-40"
                    >
                      {unlist.isPending && unlist.variables === slate.id
                        ? "Signing…"
                        : "Unlist"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {unlist.error && (
            <div className="px-4 pt-2">
              <Banner tone="error">{unlist.error.message}</Banner>
            </div>
          )}
          <p className="px-5 pt-2 text-[11px] leading-relaxed text-faint">
            Unlisting removes a basket from the feed. Anyone already holding it keeps it and
            existing links keep working — a basket is shared, so it is withdrawn rather than
            erased. Your wallet signs the request; nothing moves onchain.
          </p>
        </>
      )}

      {!portfolio.isLoading &&
        (portfolio.data?.positions.length ?? 0) === 0 &&
        (held.data?.length ?? 0) === 0 && (
          <div className="px-4 pt-6">
            <Banner>
              Nothing here yet. Build a slate or open one from the feed, and your positions will
              show up after the first buy confirms.
            </Banner>
          </div>
        )}

      {selling !== null && portfolio.data && (
        <SellSheet
          positions={portfolio.data.positions}
          preselected={selling.length > 0 ? selling : undefined}
          onClose={() => setSelling(null)}
        />
      )}
    </div>
  );
}
