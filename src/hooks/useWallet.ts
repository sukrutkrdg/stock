"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useIsInMiniApp } from "@coinbase/onchainkit/minikit";

/**
 * Wallet state, and the one way to connect.
 *
 * Inside Base App there is nothing to do: MiniKit's AutoConnect attaches the
 * user's Base Account before the first paint, which is why the UI has no
 * connect button there. Everywhere else — someone opening a shared slate link
 * in a desktop browser — the app has to offer a real connect, or the page is a
 * read-only dead end with a button that does nothing.
 */
export function useWallet() {
  const { address, isConnected, isConnecting } = useAccount();
  const { connectors, connectAsync, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { isInMiniApp } = useIsInMiniApp();

  /**
   * The connector to offer in a browser.
   *
   * The Farcaster connector sits first in the config so AutoConnect picks it up
   * inside the host, but it cannot do anything in a plain browser — so the
   * browser path deliberately skips it and reaches for Coinbase Wallet.
   */
  const browserConnector = useMemo(() => {
    const isHostConnector = (id: string, type: string) =>
      id.startsWith("farcaster") || type === "farcasterFrame" || type === "farcasterMiniApp";

    return (
      connectors.find((c) => c.id === "coinbaseWalletSDK") ??
      connectors.find((c) => !isHostConnector(c.id, c.type)) ??
      connectors[0]
    );
  }, [connectors]);

  const connect = useCallback(async () => {
    if (!browserConnector) throw new Error("No wallet connector is available.");
    await connectAsync({ connector: browserConnector });
  }, [browserConnector, connectAsync]);

  return {
    address,
    isConnected,
    // Inside the host, a moment of "connecting" is the auto-connect running;
    // showing a connect button during it would flash a control that is about to
    // become irrelevant.
    isConnecting: isConnecting || isPending,
    isInMiniApp,
    connect,
    disconnect,
    connectError: error?.message ?? null,
    canConnect: Boolean(browserConnector),
  };
}
