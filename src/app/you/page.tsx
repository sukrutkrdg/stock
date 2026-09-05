"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useSlatesFor } from "@/hooks/useSlates";
import { useMarket, tickerMap } from "@/hooks/useMarket";
import { SlateCard } from "@/components/SlateCard";
import { StockChip } from "@/components/StockChip";
import { Banner, Button, Card, SectionTitle, Skeleton } from "@/components/ui";
import { useWallet } from "@/hooks/useWallet";
import { formatShares, formatUsd, shortAddress } from "@/lib/format";
import type { DcaPlan } from "@/lib/repo";

export default function YouPage() {
  const { address, isConnected, isConnecting, isInMiniApp, connect, connectError } = useWallet();
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
      const response = await fetch(`/api/dca?owner=${address}`);
      if (!response.ok) return [];
      const body = await response.json();
      return body.plans ?? [];
    },
  });

  async function cancel(id: string) {
    await fetch(`/api/dca?owner=${address}&id=${id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["dca", address] });
  }

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

        {connectError && (
          <div className="mt-4">
            <Banner tone="error">{connectError}</Banner>
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
          <SectionTitle>Positions</SectionTitle>
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
                <Link href={`/s/${plan.slateId}`} className="text-[13px] font-semibold text-brand">
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => cancel(plan.id)}
                  className="text-[13px] text-faint transition hover:text-down"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
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
              <SlateCard key={slate.id} slate={slate} tickers={tickers} />
            ))}
          </div>
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
    </div>
  );
}
