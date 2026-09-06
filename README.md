# Slate

Baskets of tokenized stocks on Base, as a Base App Mini App.

Build a basket, buy the whole thing in one signature, share it into the feed.
Anyone who taps the card can copy it.

---

## What it actually does

**One signature per basket.** A Base Account is a smart wallet, so a slate buy
goes out as a single `wallet_sendCalls` batch — one USDC approval plus one swap
per leg. Buying a six-stock slate is one signature, not seven. Outside Base App
the same calls replay sequentially via viem's fallback, so a browser wallet
still works.

**Selling is a first-class path, not an afterthought.** Positions sell back to
USDC in one signature, in whole or in part. It is not the mirror of a buy: a
basket buy needs one approval because everything is paid for in USDC, while a
sale needs one per stock, since each is its own token. And a sale names exact
*raw* token units — derive that from a multiplier-adjusted balance and you
either overshoot the balance and revert the batch, or leave a remainder on a
position the user asked to close. Selling is keyed on positions rather than
slates, because a wallet holds fungible tokens, not baskets.

**Multiplier-aware from the ground up.** These are B20 Asset tokens, and one
token is not permanently one share — a corporate action moves the multiplier
while raw balances stay put. Every share figure in the app goes through
`scaledBalanceOf` / the multiplier, never `balanceOf` alone.

**It tells you when the market is closed.** Chainlink's equity feeds run 24/5,
so on a weekend the last round is legitimately hours old. Slate labels that
state and refuses to quote into it, rather than showing a stale number that
looks live.

**Holder counts are verified onchain.** A buy only increments a slate's counter
after the app reads the transaction receipt on Base and confirms the stock
tokens landed in that wallet. Recording is idempotent on the transaction hash,
so a retry cannot inflate the number.

**Describe a basket instead of building one.** "AI exposure, but not Tesla"
composes a slate you can then edit. The model returns *relative* weights, never
basis points: asking for integers that sum to exactly 10,000 across eight legs
invites arithmetic that is subtly wrong, and a slate that does not sum to 100%
cannot be bought. Conviction is a judgement call the model is good at; the exact
apportionment is arithmetic the code already does correctly. Its picks are a
proposal — `normalizePicks` drops invented tickers and illiquid names, collapses
duplicates, caps the count, and re-derives the weights, so whatever comes back
leaves as a buyable slate.

**Schedules remind, they do not withdraw.** A recurring plan sends a Mini App
notification that deep-links into a pre-filled buy the user signs themselves.
Slate never takes custody. See [Scheduled buys](#scheduled-buys) for why.

---

## Setup

```bash
npm install
cp .env.example .env.local     # then fill it in — see below
npm run dev
```

### Environment

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_URL` | Manifest, share links | Your deployed origin. Must match the signed domain exactly. |
| `DATABASE_URL` | Saving slates, schedules | `vercel integration add neon` injects it. |
| `FARCASTER_HEADER` / `_PAYLOAD` / `_SIGNATURE` | Listing in Base App | [base.dev](https://base.dev) account association tool. |
| `ANTHROPIC_API_KEY` | The slate composer | [console.anthropic.com](https://console.anthropic.com). Optional — without it the composer hides itself. |
| `NEXT_PUBLIC_BUILDER_CODE` | Attribution + rewards | base.dev -> Settings -> Builder Code. |
| `BASE_RPC_URL` | Optional | A dedicated RPC. Falls back to the public endpoint. |
| `CRON_SECRET` | Schedule reminders | Set by Vercel for cron invocations. |

The app degrades honestly without them: no `DATABASE_URL` and the market still
works but slates cannot be saved.

**Swap routing needs no key.** Slate routes through the KyberSwap aggregator.
The 0x Swap API — which Base's own DeFi guide documents — cannot be used for
these tokens: it answers a quote for any `*c` equity with `422
BUY_TOKEN_NOT_AUTHORIZED_FOR_TRADE`, "the buy token is not authorized for trade
due to legal restrictions". That is a compliance gate on 0x's side, not a
configuration problem; the same key quotes ordinary Base tokens fine.

### Database

```bash
vercel integration add neon        # accept the marketplace terms in the browser once
vercel env pull .env.local --yes
npm run db:migrate
```

`db:migrate` is idempotent — safe on every deploy.

---

## Publishing to Base App

1. **Deploy.** `vercel deploy --prod`. Note the production URL.
2. **Set `NEXT_PUBLIC_URL`** to that URL and redeploy, so the manifest and every
   share link agree with the domain you are about to sign.
3. **Sign the manifest.** Go to [base.dev](https://base.dev), paste the domain
   into the account association tool, and sign with the publishing wallet. Copy
   `header`, `payload` and `signature` into `FARCASTER_HEADER`,
   `FARCASTER_PAYLOAD`, `FARCASTER_SIGNATURE`, then redeploy.
4. **Verify.** Open `https://your-domain/.well-known/farcaster.json` — the
   `accountAssociation` object must be populated. If it is empty, the signature
   did not validate and Base App will not list the app. `withValidManifest`
   drops an invalid association rather than serving a broken one, so an empty
   object is the signal.
5. **Preview.** Paste the URL into [base.dev/preview](https://base.dev/preview)
   to check the embed card and that the app launches.
6. **Publish.** Complete the app's icon, screenshots and thumbnail on base.dev.
   That is what lists it in Base App's Mini App directory.

   Note: Base App removed its Farcaster-powered feed in 2026 to focus on
   trading, so there is no longer a feed inside it to post a link into.
   Distribution there is the directory. The `fc:miniapp` embed still turns a
   shared link into a launchable card in Farcaster itself, which is where the
   copy-a-slate loop lives.

---

## Scheduled buys

Slate schedules a reminder, not a transfer.

Base Account [Spend Permissions](https://docs.base.org/sdks/base-account/reference/base-pay/subscribe)
would allow a fully autonomous version: the user grants a recurring USDC
allowance once, and a backend CDP wallet charges it on schedule. The problem is
what has to happen next — that USDC lands in an app-controlled wallet, gets
swapped, and gets forwarded to the user. Funds transiting an app wallet is money
transmission, with the licensing that implies.

So the shipped design keeps the wallet in charge: the cron run
(`/api/cron/dca`) notifies, the user taps, the user signs. The
`dca_plans.subscription_id` column is already there for whoever wants to take on
the regulated version.

---

## Layout

```
src/lib/          stocks.ts      the 13 B20 tokens + their Chainlink feeds
                  b20.ts         B20 ABI and multiplier maths
                  chainlink.ts   feed ABI, staleness and market-closed thresholds
                  slate.ts       weights, apportionment, content-addressed ids
                  market.ts      one multicall for every price and multiplier
                  router.ts      KyberSwap aggregator client (server-side only)
                  compose.ts     natural language -> a constrained, buyable slate
                  sell.ts        raw-balance maths for exits
                  auth.ts        signature checks for destructive actions
                  verifyBuy.ts   receipt verification before a buy counts
                  repo.ts        Neon queries
src/app/api/      market, quote, buys, slates, portfolio, dca, notify, webhook
src/app/          /  market and feed · /create builder · /s/[id] slate · /you portfolio
scripts/          verify-onchain.mjs · test-slate.mts · migrate.mjs · make-assets.mjs
```

## Checks

```bash
npm test                 # slate maths + composer normalisation invariants
npm run verify:onchain   # every token address, feed and ABI selector, against Base
npm run verify:route     # a live buy batch
npm run verify:sell      # a live sell batch — the guard blocks this route out of hours
npm run verify:manifest  # the Mini App manifest, images and embed tag
npm run typecheck
npm run build
```

`verify:onchain` is the one to run after touching `stocks.ts` or `b20.ts`: it
calls `symbol()` on all thirteen precompiles, reads every feed, and checks the
ABI's function selectors against the published B20 reference.

---

Tokenized stocks are issued by Coinbase, backed 1:1 by shares in regulated
custody (Alpaca, ADGM), and carry dividend and voting rights. They are not
available to US persons. This app is not investment advice.
