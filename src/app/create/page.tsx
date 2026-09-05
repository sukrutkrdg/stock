"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { useMarket, tickerMap } from "@/hooks/useMarket";
import { useCreateSlate } from "@/hooks/useSlates";
import { useWallet } from "@/hooks/useWallet";
import { Composer, type Composed } from "@/components/Composer";
import { MarketList } from "@/components/MarketList";
import { WeightEditor } from "@/components/WeightEditor";
import { AllocationRing } from "@/components/AllocationRing";
import { Banner, Button, SectionTitle } from "@/components/ui";
import { decodeLegs, equalWeights, rebalance, MAX_LEGS, type Leg } from "@/lib/slate";
import { formatUsd } from "@/lib/format";

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="p-4 text-[13px] text-faint">Loading…</div>}>
      <Builder />
    </Suspense>
  );
}

function Builder() {
  const router = useRouter();
  const params = useSearchParams();
  const { address } = useWallet();
  const { context } = useMiniKit();
  const market = useMarket();
  const create = useCreateSlate();

  const seeded = useMemo(() => {
    const encoded = params.get("legs");
    if (!encoded) return [] as Leg[];
    try {
      return decodeLegs(encoded);
    } catch {
      return [] as Leg[];
    }
  }, [params]);

  const [legs, setLegs] = useState<Leg[]>(seeded);
  const [name, setName] = useState(params.get("name") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [composed, setComposed] = useState<Composed | null>(null);

  /**
   * A composed slate lands in the editor, not in a preview.
   *
   * The composer's job is to get past the blank page; the weights, the name and
   * every position stay the user's to change. Treating the result as a draft
   * rather than an answer is also what keeps this honest — nobody is being told
   * what to buy.
   */
  function onComposed(result: Composed) {
    setComposed(result);
    setLegs(result.legs);
    setName(result.name);
    setError(null);
  }

  const selected = useMemo(() => new Set(legs.map((leg) => leg.symbol)), [legs]);
  const tickers = tickerMap(market.data);

  const blended = legs.reduce((sum, leg) => {
    const price = tickers.get(leg.symbol)?.price ?? 0;
    return sum + (leg.bps / 10_000) * price;
  }, 0);

  /**
   * Adding or removing a stock resets to equal weights.
   *
   * The alternative — squeezing the newcomer in and rescaling everything — makes
   * sliders the user already set jump on their own. Equal weights are a
   * predictable starting point they can then shape.
   */
  function toggle(symbol: string) {
    setError(null);
    // Once the user edits by hand the rationale no longer describes the slate.
    setComposed(null);
    setLegs((current) => {
      const exists = current.some((leg) => leg.symbol === symbol);
      if (exists) {
        const remaining = current.filter((leg) => leg.symbol !== symbol);
        return equalWeights(remaining.map((leg) => leg.symbol));
      }
      if (current.length >= MAX_LEGS) return current;
      return equalWeights([...current.map((leg) => leg.symbol), symbol]);
    });
  }

  function setWeight(symbol: string, bps: number) {
    setComposed(null);
    setLegs((current) => rebalance(current, symbol, bps));
  }

  async function save() {
    setError(null);
    try {
      const { slate } = await create.mutateAsync({
        name: name.trim(),
        legs,
        creatorAddress: address,
        creatorFid: context?.user?.fid,
        creatorName: context?.user?.username,
      });
      router.push(`/s/${slate.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the slate.");
    }
  }

  const full = legs.length >= MAX_LEGS;

  return (
    <div className="pb-6">
      <header className="px-4 pb-1 pt-6">
        <h1 className="text-[24px] font-bold leading-tight tracking-tight">Build a slate</h1>
        <p className="mt-1 text-[14px] text-muted">
          Pick up to {MAX_LEGS} stocks, set the weights, share it.
        </p>
      </header>

      <Composer onComposed={onComposed} />

      {composed && (
        <div className="px-4 pt-3">
          <Banner>
            <span className="font-semibold text-text">{composed.name}</span> — {composed.rationale}
            {composed.dropped.length > 0 && (
              <span className="mt-1 block text-faint">
                Left out: {composed.dropped.map((d) => `${d.symbol} (${d.reason})`).join(", ")}
              </span>
            )}
          </Banner>
        </div>
      )}

      {legs.length > 0 && (
        <>
          <div className="mt-5 flex items-center gap-4 px-4">
            <AllocationRing legs={legs} size={88} thickness={10}>
              <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
                {legs.length} legs
              </span>
            </AllocationRing>
            <div className="min-w-0 flex-1">
              <label htmlFor="slate-name" className="sr-only">
                Slate name
              </label>
              <input
                id="slate-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={32}
                placeholder="Name your slate"
                className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-faint focus:border-brand"
              />
              {blended > 0 && (
                <p className="mt-2 text-[12px] tnum text-faint">
                  {formatUsd(blended)} blended price per unit
                </p>
              )}
            </div>
          </div>

          <SectionTitle>Weights</SectionTitle>
          <div className="px-4">
            <WeightEditor legs={legs} onChange={setWeight} onRemove={toggle} notes={composed?.reasons} />
          </div>
        </>
      )}

      <SectionTitle>
        {legs.length === 0 ? "Pick your stocks" : full ? `All ${MAX_LEGS} slots used` : "Add more"}
      </SectionTitle>
      <div className="px-4">
        <MarketList
          tickers={market.data?.tickers ?? []}
          loading={market.isLoading}
          onSelect={toggle}
          selected={selected}
        />
      </div>

      {error && (
        <div className="px-4 pt-4">
          <Banner tone="error">{error}</Banner>
        </div>
      )}

      <div
        className="fixed inset-x-0 bottom-[68px] z-30 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto w-full max-w-lg">
          <Button
            className="w-full"
            onClick={save}
            loading={create.isPending}
            disabled={legs.length === 0 || name.trim().length < 2}
          >
            {legs.length === 0
              ? "Pick at least one stock"
              : name.trim().length < 2
                ? "Name your slate"
                : "Save and preview"}
          </Button>
        </div>
      </div>
    </div>
  );
}
