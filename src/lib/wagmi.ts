import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { base } from "wagmi/chains";
import { coinbaseWallet } from "wagmi/connectors";
import miniAppConnector from "@farcaster/miniapp-wagmi-connector";
import { Attribution } from "ox/erc8021";

/**
 * ERC-8021 attribution suffix for Slate's Builder Code.
 *
 * The suffix is appended to the end of a transaction's calldata. Contracts
 * ignore the trailing bytes and execute normally — attribution is read back by
 * offchain indexers — so this needs no contract change and costs 16 gas per
 * non-zero byte.
 *
 * Inside Base App the host appends the code on its own because the app is
 * registered on base.dev. This covers everywhere else: a shared slate link
 * opened in a desktop browser would otherwise go unattributed.
 */
const BUILDER_CODE = process.env.NEXT_PUBLIC_BUILDER_CODE;

const dataSuffix = BUILDER_CODE
  ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  : undefined;

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
  // Applied at the client level so every transaction carries it — the slate
  // batch included — without each call site having to remember.
  dataSuffix,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
