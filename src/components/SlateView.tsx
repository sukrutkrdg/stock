"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMiniKit, useComposeCast, useAddFrame } from "@coinbase/onchainkit/minikit";
import { AllocationRing } from "./AllocationRing";
import { StockChip } from "./StockChip";
import { Banner, Button, Card, SectionTitle, Spinner } from "./ui";
import { ScheduleSheet } from "./ScheduleSheet";
import { useMarket, tickerMap } from "@/hooks/useMarket";
import { useBuySlate } from "@/hooks/useBuySlate";
import { useWallet } from "@/hooks/useWallet";
import { useUnlistSlate } from "@/hooks/useSlates";
import { formatPercent, formatShares, formatUsd, formatWeight } from "@/lib/format";
import { parseAmount, sanitizeAmount } from "@/lib/amount";
import type { Slate } from "@/lib/slate";

const PRESETS = [25, 50, 100, 250];

export function SlateView({ slate }: { slate: Slate }) {
  const params = useSearchParams();
  const { address, isConnected, isConnecting, stuck, connect, disconnect, connectError } =
    useWallet();
  const { setMiniAppReady, isMiniAppReady, context } = useMiniKit();
  const { composeCastAsync } = useComposeCast();
  const addFrame = useAddFrame();
  const market = useMarket();
  const buySlate = useBuySlate();
  const unlist = useUnlistSlate();

  // A schedule reminder deep-links in with the amount already chosen, so the
  // user lands on a filled-in buy rather than re-entering what they set up.
  // Held as text so the field can be empty while it is being retyped.
  const [amountText, setAmountText] = useState(() => {
    const seeded = Number(params.get("amount"));
    return Number.isFinite(seeded) && seeded > 0 ? String(seeded) : "50";
  });
  const amount = parseAmount(amountText);

  function changeAmount(next: string) {
    setAmountText(sanitizeAmount(next));
    buySlate.reset();
  }
  const [scheduling, setScheduling] = useState(false);
  // Reset with every new quote: consent is to the numbers on screen, not a
  // preference the user set once and forgot.
  const [acceptedOffHours, setAcceptedOffHours] = useState(false);
  const [copiesShown, setCopiesShown] = useState(slate.copies);

  useEffect(() => {
    if (!isMiniAppReady) void setMiniAppReady();
  }, [isMiniAppReady, setMiniAppReady]);

  const tickers = tickerMap(market.data);
  const marketClosed = market.data?.marketClosed ?? false;

  const untradable = slate.legs.filter((leg) => tickers.get(leg.symbol)?.tradable === false);
  const blended = slate.legs.reduce((sum, leg) => {
    const price = tickers.get(leg.symbol)?.price ?? 0;
    return sum + (leg.bps / 10_000) * price;
  }, 0);

  const { stage, quote, error, result } = buySlate;
  const busy = stage === "quoting" || stage === "signing" || stage === "confirming" || stage === "recording";

  async function onPreview() {
    try {
      setAcceptedOffHours(false);
      await buySlate.preview({ legs: slate.legs, budgetUsdc: amount });
    } catch {
      // The hook already surfaced the message; nothing to add here.
    }
  }

  async function onBuy() {
    if (!quote) return;
    try {
      const outcome = await buySlate.buy({ slateId: slate.id, quote });
      setCopiesShown(outcome.copies || copiesShown);
      // Asking to add the app right after a successful buy is the one moment
      // the request is obviously worth something: it is what makes schedule
      // reminders possible at all.
      void addFrame();
    } catch {
      // Handled in the hook.
    }
  }

  async function onConnect() {
    try {
      await connect();
    } catch {
      // useWallet surfaces the message; a rejected connection is not an error
      // worth interrupting the page for.
    }
  }

  const [shared, setShared] = useState<string | null>(null);

  /**
   * Share a slate, by whatever route the host actually offers.
   *
   * Composing a cast used to be the whole distribution story: post a slate,
   * someone taps the card, they own the same basket. Base App has since removed
   * its Farcaster feed to focus on trading, so inside it there is no longer a
   * feed to post into and `composeCast` may simply not be supported.
   *
   * So the composer is attempted and then fallen back on rather than assumed —
   * a cast where a feed exists, the system share sheet on a phone, the
   * clipboard everywhere else. A share button that silently does nothing is
   * worse than one that copies a link.
   */
  async function onShare() {
    const url = `${window.location.origin}/s/${slate.id}`;
    const text = `${slate.name} — ${slate.legs
      .map((leg) => leg.symbol.replace(/c$/, ""))
      .join(" · ")}. Built on Slate.`;

    try {
      await composeCastAsync({ text, embeds: [url] });
      return;
    } catch {
      // No feed in this host; fall through to the platform's own sharing.
    }

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: slate.name, text, url });
        return;
      }
    } catch {
      // A cancelled share sheet lands here too; the clipboard is still useful.
    }

    try {
      await navigator.clipboard.writeText(url);
      setShared("Link copied");
      setTimeout(() => setShared(null), 2500);
    } catch {
      setShared(url);
    }
  }

  return (
    <div className="pb-40">
      <header className="flex items-center gap-4 px-4 pt-6">
        <AllocationRing legs={slate.legs} size={92} thickness={11}>
          <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
            {slate.legs.length} legs
          </span>
        </AllocationRing>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight">
            {slate.name}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            {copiesShown} bought
            {slate.creatorName ? ` · by ${slate.creatorName}` : ""}
          </p>
          {blended > 0 && (
            <p className="mt-0.5 text-[13px] tnum text-faint">{formatUsd(blended)} blended</p>
          )}
        </div>
      </header>

      <div className="space-y-2 px-4 pt-5">
        {marketClosed && (
          <Banner tone="warn">
            The equity market is closed, so these prices are the last close. The pools still
            trade — you can buy now, at whatever the pool quotes.
          </Banner>
        )}
        {untradable.length > 0 && (
          <Banner tone="info">
            {untradable.map((leg) => leg.symbol.replace(/c$/, "")).join(", ")} has no onchain
            liquidity yet. That leg will be skipped and its share stays in USDC.
          </Banner>
        )}
      </div>

      <SectionTitle>Composition</SectionTitle>
      <ul className="mx-4 divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
        {slate.legs.map((leg) => {
          const ticker = tickers.get(leg.symbol);
          const legQuote = quote?.legs.find((entry) => entry.symbol === leg.symbol);
          const bought = legQuote ? Number(legQuote.buyAmount) / 10 ** legQuote.decimals : null;

          return (
            <li key={leg.symbol} className="flex items-center gap-3 p-3.5">
              <StockChip symbol={leg.symbol} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold leading-tight">
                  {ticker?.ticker ?? leg.symbol}
                </p>
                <p className="truncate text-[12px] text-faint">
                  {formatWeight(leg.bps)} · {formatUsd((amount * leg.bps) / 10_000)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-semibold tnum leading-tight">
                  {ticker && ticker.price > 0 ? formatUsd(ticker.price) : "—"}
                </p>
                <p className="text-[11px] tnum text-faint">
                  {bought !== null ? `≈ ${formatShares(bought)} sh` : ticker?.stale ? "last close" : "live"}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <SectionTitle>Amount</SectionTitle>
      <div className="px-4">
        <Card className="p-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-bold leading-none text-faint">$</span>
            <input
              // Text, not number: a number input adds spinners, rejects a
              // partially typed value, and on some keypads will not let the
              // field be emptied at all.
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              value={amountText}
              onChange={(event) => changeAmount(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder="0"
              aria-label="Amount in USDC"
              className="w-full bg-transparent text-[34px] font-bold leading-none tabular-nums outline-none placeholder:text-faint"
            />
            <span className="shrink-0 text-[13px] font-medium text-faint">USDC</span>
          </div>

          <div className="mt-4 flex gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => changeAmount(String(preset))}
                className={`flex-1 rounded-lg border py-2 text-[13px] font-semibold tabular-nums transition ${
                  amount === preset
                    ? "border-brand bg-brand-soft text-text"
                    : "border-line text-muted"
                }`}
              >
                ${preset}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {quote && (
        <>
          <SectionTitle>Route</SectionTitle>
          <div className="px-4">
            <Card className="divide-y divide-line-soft">
              {quote.legs.map((leg) => (
                <div key={leg.symbol} className="flex items-center justify-between p-3.5 text-[13px]">
                  <span className="font-medium">{leg.ticker}</span>
                  <span className="tnum text-muted">
                    {formatUsd(Number(leg.sellUsdc) / 1e6)} →{" "}
                    {formatShares(Number(leg.buyAmount) / 10 ** leg.decimals)} sh
                    <span
                      className={`ml-2 ${leg.premiumPercent > 0.5 ? "text-warn" : "text-faint"}`}
                    >
                      {formatPercent(leg.premiumPercent, true)}
                    </span>
                  </span>
                </div>
              ))}
              {quote.skipped.length > 0 && (
                <div className="p-3.5 text-[12px] text-faint">
                  Skipped: {quote.skipped.map((entry) => `${entry.symbol} (${entry.reason})`).join(", ")}
                </div>
              )}
              <div className="flex items-center justify-between p-3.5 text-[13px]">
                <span className="font-medium">Total</span>
                <span className="tnum">{formatUsd(Number(quote.spentUsdc) / 1e6)}</span>
              </div>
              <div className="p-3.5 text-[11px] leading-relaxed text-faint">
                One approval plus {quote.legs.length}{" "}
                {quote.legs.length === 1 ? "swap" : "swaps"}. A smart wallet signs all of it at
                once; a wallet without batching asks for the approval first and then each swap in
                turn, so several prompts is normal and each one shows only its own leg.
                Percentages compare the route against the Chainlink feed;{" "}
                {(quote.slippageBps / 100).toFixed(1)}% slippage is encoded into the calldata, so a
                worse fill reverts instead of settling.
              </div>
            </Card>
          </div>
        </>
      )}

      {quote && quote.marketClosed && (
        <div className="px-4 pt-4">
          <div className="rounded-xl border border-warn/30 bg-warn/10 p-3.5">
            <p className="text-[13px] leading-snug text-warn">
              <span className="font-semibold">Trading outside market hours.</span> Nothing is
              arbitraging these pools against the underlying right now, so the price can drift and
              a move in the stock will not be reflected until the feeds resume.
            </p>
            <p className="mt-2 text-[12px] tnum text-warn/80">
              Furthest from last close:{" "}
              {(() => {
                const worst = quote.legs.reduce((a, b) =>
                  Math.abs(b.premiumPercent) > Math.abs(a.premiumPercent) ? b : a,
                );
                return `${worst.ticker} ${formatPercent(worst.premiumPercent, true)}`;
              })()}
            </p>
            <label className="mt-3 flex items-start gap-2.5 text-[13px] text-text">
              <input
                type="checkbox"
                checked={acceptedOffHours}
                onChange={(event) => setAcceptedOffHours(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-brand)]"
              />
              I understand I am buying at the pool price, not the last close.
            </label>
          </div>
        </div>
      )}

      {(error || connectError || stuck) && (
        <div className="space-y-3 px-4 pt-4">
          <Banner tone="error">
            {stuck
              ? "A wallet session is half-open, which is why connecting keeps failing."
              : (error ?? connectError)}
          </Banner>
          {stuck && (
            <Button variant="secondary" className="w-full" onClick={() => void disconnect()}>
              Reset the wallet session
            </Button>
          )}
        </div>
      )}

      {result && (
        <div className="px-4 pt-4">
          <Banner tone="info">
            <span className="font-semibold text-up">Bought.</span> {result.received.join(", ")}{" "}
            landed in your wallet. That makes {copiesShown} {copiesShown === 1 ? "buyer" : "buyers"}.
          </Banner>
        </div>
      )}

      {address &&
        slate.creatorAddress?.toLowerCase() === address.toLowerCase() &&
        true && (
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
              <span className="text-[13px] text-muted">You made this basket.</span>
              <button
                type="button"
                onClick={() => unlist.mutate(slate.id)}
                disabled={unlist.isPending}
                className="-mr-2 px-3 py-2 text-[13px] font-semibold text-muted transition hover:text-down disabled:opacity-40"
              >
                {unlist.isPending ? "Signing…" : "Remove"}
              </button>
            </div>
            {unlist.isSuccess && (
              <p className="mt-2 text-[12px] text-faint">
                Removed. If nobody held it, it is gone; otherwise it is out of the feed and
                holders keep it.
              </p>
            )}
            {unlist.error && (
              <p className="mt-2 text-[12px] text-down">{unlist.error.message}</p>
            )}
          </div>
        )}

      <div className="px-4 pt-4">
        <button
          type="button"
          onClick={() => setScheduling(true)}
          className="w-full rounded-xl border border-dashed border-line px-4 py-3 text-left text-[13px] text-muted transition active:bg-surface"
        >
          <span className="font-semibold text-text">Buy this on a schedule</span>
          <br />
          Get a reminder every week and sign it in one tap.
        </button>
      </div>

      <div
        className="fixed inset-x-0 bottom-[68px] z-30 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-lg gap-2">
          <Button variant="secondary" onClick={() => void onShare()} aria-label="Share this slate">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 15V4m0 0L8 8m4-4 4 4M5 14v4.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Share
          </Button>

          {result ? (
            <Button className="flex-1" variant="secondary" onClick={() => buySlate.reset()}>
              Buy again
            </Button>
          ) : quote ? (
            <Button
              className="flex-1"
              onClick={onBuy}
              loading={busy}
              disabled={quote.marketClosed && !acceptedOffHours}
            >
              {stage === "signing"
                ? "Confirm in your wallet"
                : stage === "confirming"
                  ? "Confirming…"
                  : stage === "recording"
                    ? "Almost there…"
                    : quote.marketClosed
                      ? `Buy at pool price · ${formatUsd(Number(quote.spentUsdc) / 1e6)}`
                      : `Buy ${formatUsd(Number(quote.spentUsdc) / 1e6)}`}
            </Button>
          ) : !isConnected ? (
            <Button className="flex-1" onClick={onConnect} loading={isConnecting}>
              {isConnecting ? "Connecting…" : "Connect a wallet"}
            </Button>
          ) : (
            <Button
              className="flex-1"
              onClick={onPreview}
              loading={stage === "quoting"}
              disabled={amount < 5}
            >
              {stage === "quoting"
                ? "Pricing…"
                : marketClosed
                  ? "Preview at pool price"
                  : "Preview route"}
            </Button>
          )}
        </div>
      </div>

      {scheduling && (
        <ScheduleSheet
          slate={slate}
          defaultAmount={amount}
          owner={address}
          fid={context?.user?.fid}
          onClose={() => setScheduling(false)}
        />
      )}

      {shared && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
          <span className="rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-muted shadow-lg">
            {shared}
          </span>
        </div>
      )}

      {stage === "confirming" && (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
          <span className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13px] text-muted shadow-lg">
            <Spinner /> Waiting for Base
          </span>
        </div>
      )}
    </div>
  );
}
