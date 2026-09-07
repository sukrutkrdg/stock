"use client";

import { useQuery } from "@tanstack/react-query";
import { SectionTitle, Skeleton } from "./ui";
import { formatUsd } from "@/lib/format";
import type { Activity as ActivityRow } from "@/lib/repo";

/**
 * What this wallet has actually done, each row carrying the transaction that
 * proves it.
 *
 * The app's record of a trade is worth exactly as much as the link to the chain
 * beside it — anyone can write a row claiming a purchase, and only Basescan can
 * settle whether it happened.
 */
export function Activity({ owner }: { owner: string }) {
  const activity = useQuery({
    queryKey: ["activity", owner],
    queryFn: async (): Promise<ActivityRow[]> => {
      const response = await fetch(`/api/activity?owner=${encodeURIComponent(owner)}`);
      if (!response.ok) throw new Error("Could not load your activity.");
      return (await response.json()).activity ?? [];
    },
  });

  if (activity.isLoading) {
    return (
      <>
        <SectionTitle>Activity</SectionTitle>
        <div className="px-4">
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      </>
    );
  }

  if (!activity.data?.length) return null;

  return (
    <>
      <SectionTitle>Activity</SectionTitle>
      <ul className="mx-4 divide-y divide-line-soft overflow-hidden rounded-2xl border border-line bg-surface">
        {activity.data.map((row) => (
          <li key={row.txHash} className="flex items-center gap-3 p-3.5">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                row.kind === "buy" ? "bg-brand-soft text-brand" : "bg-raised text-muted"
              }`}
              aria-hidden
            >
              {row.kind === "buy" ? "IN" : "OUT"}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold leading-tight">
                {row.kind === "buy"
                  ? `Bought ${row.slateName ?? "a basket"}`
                  : `Sold ${row.symbols.map((s) => s.replace(/c$/, "")).join(", ") || "positions"}`}
              </p>
              <p className="mt-0.5 text-[11px] tnum text-faint">
                {new Date(row.at).toLocaleString()}
              </p>
            </div>

            <div className="text-right">
              <p className="text-[14px] font-semibold tnum leading-tight">
                {row.kind === "buy" ? "−" : "+"}
                {formatUsd(Number(row.amountUsdc))}
              </p>
              <a
                href={`https://basescan.org/tx/${row.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-semibold text-brand"
              >
                Basescan
              </a>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-5 pt-2 text-[11px] leading-relaxed text-faint">
        Every row links to the transaction on Base. That link, not this list, is the record.
      </p>
    </>
  );
}
