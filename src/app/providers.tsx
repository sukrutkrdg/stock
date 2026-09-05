"use client";

import { MiniKitProvider } from "@coinbase/onchainkit/minikit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useState, type ReactNode } from "react";
import { wagmiConfig } from "@/lib/wagmi";

/**
 * MiniKitProvider supplies the Base App context and auto-connects the host
 * wallet, but it does not bring its own wagmi provider — it consumes one. So
 * WagmiProvider has to sit outside it, with the Farcaster connector first in
 * the list for auto-connect to take.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Prices come off a 24/5 feed. Refetching harder than the feed
            // publishes just burns the user's battery for the same number.
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MiniKitProvider enabled autoConnect>
          {children}
        </MiniKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
