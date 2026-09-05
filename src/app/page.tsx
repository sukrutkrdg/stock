"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { useMarket, tickerMap } from "@/hooks/useMarket";
import { useTrendingSlates } from "@/hooks/useSlates";
import { MarketStatus } from "@/components/MarketStatus";
import { MarketList } from "@/components/MarketList";
import { SlateCard } from "@/components/SlateCard";
import { AllocationRing } from "@/components/AllocationRing";
import { SectionTitle, Skeleton, Card } from "@/components/ui";
import { TEMPLATES } from "@/lib/templates";
import { encodeLegs } from "@/lib/slate";

export default function HomePage() {
  const { setMiniAppReady, isMiniAppReady } = useMiniKit();
  const market = useMarket();
  const trending = useTrendingSlates();

  // Dismisses the host's splash screen. Called after the first paint so the
  // user never sees an empty frame between splash and content.
  useEffect(() => {
    if (!isMiniAppReady) void setMiniAppReady();
  }, [isMiniAppReady, setMiniAppReady]);

  const tickers = tickerMap(market.data);
  const hasTrending = (trending.data?.length ?? 0) > 0;

  return (
    <div>
      <header className="px-4 pb-1 pt-6">
        <h1 className="text-[28px] font-bold leading-none tracking-tight">Slate</h1>
        <p className="mt-1.5 text-[14px] leading-snug text-muted">
          Baskets of tokenized stocks on Base. Build one, buy it in a tap, share it.
        </p>
      </header>

      <div className="px-4 pt-4">
        <MarketStatus market={market.data} />
      </div>

      {market.isError && (
        <div className="px-4 pt-3">
          <Card className="p-4 text-[13px] text-muted">
            Could not reach Base right now. Prices will return on their own.
          </Card>
        </div>
      )}

      <SectionTitle
        action={
          <Link href="/create" className="text-[13px] font-semibold text-brand">
            Build your own
          </Link>
        }
      >
        Starter slates
      </SectionTitle>

      <div className="no-scrollbar flex gap-3 overflow-x-auto px-4 pb-1">
        {TEMPLATES.map((template) => (
          <Link
            key={template.name}
            href={`/create?legs=${encodeLegs(template.legs)}&name=${encodeURIComponent(template.name)}`}
            className="flex w-[210px] shrink-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition active:scale-[0.99]"
          >
            <AllocationRing legs={template.legs} size={56} thickness={7} />
            <div>
              <h3 className="text-[15px] font-semibold leading-tight">{template.name}</h3>
              <p className="mt-1 text-[12px] leading-snug text-faint">{template.blurb}</p>
            </div>
          </Link>
        ))}
      </div>

      {(hasTrending || trending.isLoading) && (
        <>
          <SectionTitle>Trending</SectionTitle>
          <div className="space-y-2 px-4">
            {trending.isLoading
              ? Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-[104px] w-full rounded-2xl" />
                ))
              : trending.data!.map((slate) => (
                  <SlateCard key={slate.id} slate={slate} tickers={tickers} />
                ))}
          </div>
        </>
      )}

      <SectionTitle>All stocks</SectionTitle>
      <div className="px-4">
        <MarketList tickers={market.data?.tickers ?? []} loading={market.isLoading} />
      </div>

      <p className="px-5 pb-4 pt-6 text-[11px] leading-relaxed text-faint">
        Tokenized stocks are issued by Coinbase and backed 1:1 by shares held in regulated custody.
        Prices come from Chainlink total-return feeds. Slate never holds your funds — every buy is
        signed by your own wallet. Not investment advice.
      </p>
    </div>
  );
}
