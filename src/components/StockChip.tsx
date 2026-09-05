import { stockBySymbol } from "@/lib/stocks";

/** The ticker badge used wherever a stock appears in a list or a slate. */
export function StockChip({ symbol, size = "md" }: { symbol: string; size?: "sm" | "md" }) {
  const stock = stockBySymbol(symbol);
  const label = stock?.ticker ?? symbol;
  const dimensions = size === "sm" ? "h-7 w-7 text-[9px]" : "h-9 w-9 text-[10px]";

  return (
    <span
      className={`inline-flex ${dimensions} shrink-0 items-center justify-center rounded-full font-bold tracking-tight text-ink`}
      style={{ background: stock?.color ?? "var(--color-brand)" }}
      title={stock?.name ?? symbol}
    >
      {label.slice(0, 4)}
    </span>
  );
}
