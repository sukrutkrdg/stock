"use client";

import { stockBySymbol } from "@/lib/stocks";
import type { Leg } from "@/lib/slate";

/**
 * A slate's weights as a single ring.
 *
 * Drawn with stroke-dasharray on one circle rather than as pie wedges: at
 * 64–120px on a phone, arcs stay legible where wedge tips collapse into noise,
 * and a 1% leg still renders as a visible sliver instead of vanishing.
 */
export function AllocationRing({
  legs,
  size = 96,
  thickness = 10,
  children,
}: {
  legs: Leg[];
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = legs.length > 1 ? 1.5 : 0;

  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-line-soft)"
          strokeWidth={thickness}
        />
        {legs.map((leg) => {
          const stock = stockBySymbol(leg.symbol);
          const fraction = leg.bps / 10_000;
          const length = Math.max(0, circumference * fraction - gap);
          const dash = `${length} ${circumference - length}`;
          const start = -circumference * offset;
          offset += fraction;

          return (
            <circle
              key={leg.symbol}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={stock?.color ?? "var(--color-brand)"}
              strokeWidth={thickness}
              strokeDasharray={dash}
              strokeDashoffset={start}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      )}
    </div>
  );
}
