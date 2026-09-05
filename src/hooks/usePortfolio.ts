"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Portfolio } from "@/app/api/portfolio/route";

export function usePortfolio() {
  const { address } = useAccount();

  return useQuery({
    queryKey: ["portfolio", address],
    enabled: Boolean(address),
    refetchInterval: 60_000,
    queryFn: async (): Promise<Portfolio> => {
      const response = await fetch(`/api/portfolio?owner=${address}`);
      if (!response.ok) throw new Error("Could not read your positions.");
      return response.json();
    },
  });
}
