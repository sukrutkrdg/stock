"use client";

import { useCallback, useMemo } from "react";
import { useAccount, useConnect, useConnections, useDisconnect } from "wagmi";
import { useIsInMiniApp } from "@coinbase/onchainkit/minikit";

/**
 * Wallet state, and the one way to connect.
 *
 * Inside Base App there is nothing to do: MiniKit's AutoConnect attaches the
 * user's Base Account before the first paint, which is why the UI has no
 * connect button there. Everywhere else — someone opening a shared slate link
 * in a browser — the app has to offer a real connect, or the page is a
 * read-only dead end.
 */
export function useWallet() {
  const { address, isConnected, status } = useAccount();
  const connections = useConnections();
  const { connectors, connectAsync, isPending, error, reset } = useConnect();
  const { disconnectAsync } = useDisconnect();
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

  /**
   * True when wagmi holds a live connection that `useAccount` has not surfaced.
   *
   * This state is reachable: a connector can register as connected while the
   * account never resolves, leaving `isConnected` false. The UI then shows
   * "Connect a wallet", the click calls `connect()`, and wagmi answers
   * `ConnectorAlreadyConnectedError` — a loop with no way out, which is exactly
   * what it did before this check existed.
   */
  const stuck = !isConnected && connections.length > 0;

  const connect = useCallback(async () => {
    if (!browserConnector) throw new Error("No wallet connector is available.");

    // Clear a half-open connection first, so the retry starts from a known
    // state instead of colliding with the one already registered.
    if (connections.length > 0) {
      await disconnectAsync().catch(() => {});
    }

    try {
      await connectAsync({ connector: browserConnector });
    } catch (cause) {
      // Already connected is not a failure the user can act on — the account
      // is on its way. Anything else is theirs to see.
      const message = cause instanceof Error ? cause.message : "";
      if (/already connected/i.test(message)) {
        reset();
        return;
      }
      throw cause;
    }
  }, [browserConnector, connectAsync, connections.length, disconnectAsync, reset]);

  /** Escape hatch: lets a wedged session be cleared without clearing site data. */
  const disconnect = useCallback(async () => {
    await disconnectAsync().catch(() => {});
    reset();
  }, [disconnectAsync, reset]);

  return {
    address,
    isConnected,
    /**
     * Only the user's own connect attempt counts as "connecting".
     *
     * Deliberately not wagmi's `useAccount().isConnecting`, which also covers
     * the reconnect wagmi runs on mount. Outside a Mini App that reconnect
     * probes the Farcaster connector, which has no host to answer it and hangs
     * rather than rejecting — so the account status sits on "connecting"
     * forever, and gating the button on it left a permanently disabled
     * "Connecting…" that could never be clicked.
     */
    isConnecting: isPending,
    isInMiniApp,
    stuck,
    status,
    connect,
    disconnect,
    connectError: error?.message ?? null,
    canConnect: Boolean(browserConnector),
  };
}
