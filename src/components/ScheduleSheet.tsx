"use client";

import { useState } from "react";
import { useAddFrame } from "@coinbase/onchainkit/minikit";
import { Banner, Button } from "./ui";
import { formatUsd } from "@/lib/format";
import type { Slate } from "@/lib/slate";

const PERIODS = [
  { days: 1, label: "Daily" },
  { days: 7, label: "Weekly" },
  { days: 14, label: "Biweekly" },
  { days: 30, label: "Monthly" },
];

/**
 * Set up a recurring buy.
 *
 * Slate schedules a reminder, not a withdrawal. When a plan comes due the user
 * gets a notification that opens this slate with the amount filled in, and they
 * sign it themselves. Nothing leaves a wallet without a signature and Slate
 * never takes custody — the tradeoff is one tap per buy, which is the right
 * side of that trade for an app that is not a licensed money transmitter.
 */
export function ScheduleSheet({
  slate,
  defaultAmount,
  owner,
  fid,
  onClose,
}: {
  slate: Slate;
  defaultAmount: number;
  owner: string | undefined;
  fid: number | undefined;
  onClose: () => void;
}) {
  const addFrame = useAddFrame();
  const [amount, setAmount] = useState(defaultAmount);
  const [periodDays, setPeriodDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!owner) {
      setError("Connect a wallet first.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      // The reminder is the whole mechanism, so the app has to be added before
      // the schedule means anything. Ask first, then save.
      if (fid !== undefined) await addFrame();

      const response = await fetch("/api/dca", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, fid, slateId: slate.id, amountUsdc: amount, periodDays }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not save the schedule.");
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />

      <div
        className="relative mx-auto w-full max-w-lg rounded-t-3xl border-t border-line bg-surface p-5"
        style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        {saved ? (
          <div className="space-y-4 text-center">
            <h2 className="text-[19px] font-bold">Schedule set</h2>
            <p className="text-[14px] leading-snug text-muted">
              Every {periodDays === 1 ? "day" : `${periodDays} days`} you will get a notification to
              put {formatUsd(amount)} into {slate.name}. One tap to sign, and nothing moves until
              you do.
            </p>
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <h2 className="text-[19px] font-bold leading-tight">Buy on a schedule</h2>
            <p className="mt-1 text-[13px] leading-snug text-muted">
              We remind you; you sign. Slate never pulls funds from your wallet.
            </p>

            <label className="mt-5 block text-[12px] font-semibold uppercase tracking-wide text-faint">
              Amount
            </label>
            <div className="mt-2 flex items-baseline gap-2 rounded-xl border border-line bg-raised px-3.5 py-3">
              <span className="text-[20px] font-bold text-faint">$</span>
              <input
                type="number"
                inputMode="decimal"
                min={5}
                step={5}
                value={amount}
                onChange={(event) => setAmount(Number(event.target.value))}
                aria-label="Recurring amount in USDC"
                className="w-full bg-transparent text-[24px] font-bold tabular-nums outline-none"
              />
              <span className="text-[12px] text-faint">USDC</span>
            </div>

            <label className="mt-5 block text-[12px] font-semibold uppercase tracking-wide text-faint">
              How often
            </label>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {PERIODS.map((period) => (
                <button
                  key={period.days}
                  type="button"
                  onClick={() => setPeriodDays(period.days)}
                  className={`rounded-lg border py-2.5 text-[13px] font-semibold transition ${
                    periodDays === period.days
                      ? "border-brand bg-brand-soft text-text"
                      : "border-line text-muted"
                  }`}
                >
                  {period.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="mt-4">
                <Banner tone="error">{error}</Banner>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} loading={saving} disabled={amount < 5}>
                Schedule {formatUsd(amount)}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
