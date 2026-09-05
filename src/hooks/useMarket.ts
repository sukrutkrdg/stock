"use client";

import { useQuery } from "@tanstack/react-query";
import type { Market, Ticker } from "@/lib/market";

async function fetchMarket(): Promise<Market> {
  const response = await fetch("/api/market");
  if (!response.ok) throw new Error("Could not load prices.");
  return response.json();
}

export function useMarket() {
  return useQuery({
    queryKey: ["market"],
    queryFn: fetchMarket,
    // Matches the route's cache window. Polling faster only re-reads the same
    // cached response and, when the market is closed, the same frozen round.
    refetchInterval: 30_000,
  });
}

export function tickerMap(market: Market | undefined): Map<string, Ticker> {
  return new Map((market?.tickers ?? []).map((t) => [t.symbol, t]));
}
