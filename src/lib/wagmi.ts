import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet } from "wagmi/connectors";
import miniAppConnector from "@farcaster/miniapp-wagmi-connector";

/**
 * Wagmi config for Slate.
 *
 * Connector order matters: MiniKit's AutoConnect only fires when the *first*
 * connector is the Farcaster/Base App one, which is what makes the app connect
 * silently inside the host and show no connect button at all. The Coinbase
 * Wallet connector behind it is the path for anyone who opens the same URL in a
 * desktop browser.
 *
 * `ssr` keeps wagmi from reading browser storage during prerender, so the pages
 * can still be statically generated at build time.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [miniAppConnector(), coinbaseWallet({ appName: "Slate", preference: "all" })],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL || undefined),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
