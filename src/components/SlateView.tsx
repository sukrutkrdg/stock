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
import { formatPercent, formatShares, formatUsd, formatWeight } from "@/lib/format";
import type { Slate } from "@/lib/slate";

const PRESETS = [25, 50, 100, 250];

export function SlateView({ slate }: { slate: Slate }) {
  const params = useSearchParams();
  const { address, isConnected, isConnecting, stuck, connect, disconnect, connectError } =
    useWallet();
  const { setMiniAppReady, isMiniAppReady, context } = useMiniKit();
  const { composeCast } = useComposeCast();
  const addFrame = useAddFrame();
  const market = useMarket();
  const buySlate = useBuySlate();

  // A schedule reminder deep-links in with the amount already chosen, so the
  // user lands on a filled-in buy rather than re-entering what they set up.
  const [amount, setAmount] = useState(() => {
    const seeded = Number(params.get("amount"));
    return Number.isFinite(seeded) && seeded > 0 ? seeded : 50;
  });
  const [scheduling, setScheduling] = useState(false);
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

  function onShare() {
    composeCast({
      text: `${slate.name} — ${slate.legs.map((leg) => leg.symbol.replace(/c$/, "")).join(" · ")}. Built on Slate.`,
      embeds: [`${window.location.origin}/s/${slate.id}`],
    });
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
            {copiesShown} {copiesShown === 1 ? "holder" : "holders"}
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
            The equity market is closed. Prices are last-close and buys are paused until the
            Chainlink feeds resume.
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
              type="number"
              inputMode="decimal"
              min={5}
              step={5}
              value={amount}
              onChange={(event) => {
                setAmount(Number(event.target.value));
                buySlate.reset();
              }}
              aria-label="Amount in USDC"
              className="w-full bg-transparent text-[34px] font-bold leading-none tabular-nums outline-none"
            />
            <span className="shrink-0 text-[13px] font-medium text-faint">USDC</span>
          </div>

          <div className="mt-4 flex gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setAmount(preset);
                  buySlate.reset();
                }}
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
                {quote.legs.length === 1 ? "swap" : "swaps"}, sent as a single batch you sign once.
                Percentages compare the route against the Chainlink feed;{" "}
                {(quote.slippageBps / 100).toFixed(1)}% slippage is encoded into the calldata, so a
                worse fill reverts instead of settling.
              </div>
            </Card>
          </div>
        </>
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
            landed in your wallet. You are holder #{copiesShown}.
          </Banner>
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
          <Button variant="secondary" onClick={onShare} aria-label="Share this slate">
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
            <Button className="flex-1" onClick={onBuy} loading={busy}>
              {stage === "signing"
                ? "Confirm in your wallet"
                : stage === "confirming"
                  ? "Confirming…"
                  : stage === "recording"
                    ? "Almost there…"
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
              disabled={marketClosed || amount < 5}
            >
              {marketClosed
                ? "Market closed"
                : stage === "quoting"
                  ? "Pricing…"
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
