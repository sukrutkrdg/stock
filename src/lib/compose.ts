import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { readMarket, type Ticker } from "./market";
import { apportion, canonicalize, MAX_LEGS, MIN_LEG_BPS, TOTAL_BPS, type Leg } from "./slate";

export class ComposeError extends Error {}

/**
 * What the model is asked to return.
 *
 * Weights are *relative*, not basis points, and that is the whole trick. Asking
 * a model for integers that sum to exactly 10,000 across up to eight legs
 * invites arithmetic that is subtly off — and a slate whose weights do not sum
 * to 100% cannot be priced or bought. Relative weights are a judgement call,
 * which the model is good at; the exact apportionment is arithmetic, which
 * `apportion` already does correctly and is covered by tests.
 */
const Composition = z.object({
  name: z.string().describe("A short, memorable name for the basket. Max 32 characters."),
  rationale: z
    .string()
    .describe("One sentence, max 140 characters, explaining the shape of the basket."),
  picks: z
    .array(
      z.object({
        symbol: z.string().describe("The exact onchain symbol from the universe, e.g. NVDAc."),
        weight: z
          .number()
          .describe("Relative conviction, any positive number. These are normalised later."),
        why: z.string().describe("At most 8 words on why this stock is in the basket."),
      }),
    )
    .min(1)
    .max(MAX_LEGS),
});

export type Composition = z.infer<typeof Composition>;

export type ComposeResult = {
  name: string;
  rationale: string;
  legs: Leg[];
  reasons: Record<string, string>;
  /** Stocks the model asked for that could not be included, and why. */
  dropped: { symbol: string; reason: string }[];
};

const SYSTEM = `You turn a plain-language investment idea into a basket of tokenized stocks.

You may only choose from the universe given in the user message. Never invent a
symbol; never reach for a company that is not listed there, however well it fits
the request — say so in the rationale instead.

How to weight:
- Weights are relative conviction, not percentages. The app normalises them.
- Concentrate when the user expresses a clear thesis; spread when they ask for
  breadth or say they want to diversify.
- A basket of one is a valid answer to a request about one company.

Honour exclusions literally. If the user says "no Tesla", TSLAc must not appear,
even if it fits the theme.

Name the basket for the idea, not the tickers: "AI Buildout", not "NVDA + MSFT".

You are composing a basket, not giving advice. Do not predict returns, promise
outcomes, or tell the user this is a good investment. The rationale describes
what the basket holds and why those names fit the request — nothing more.`;

function universe(tickers: Ticker[]): string {
  const tradable = tickers.filter((t) => t.tradable);
  const rows = tradable
    .map((t) => `${t.symbol}\t${t.ticker}\t${t.name}\t${t.sector}\t$${t.price.toFixed(2)}`)
    .join("\n");

  const untradable = tickers.filter((t) => !t.tradable).map((t) => t.ticker);

  return [
    "SYMBOL\tTICKER\tCOMPANY\tSECTOR\tLAST PRICE",
    rows,
    untradable.length
      ? `\nNot available (no onchain liquidity yet, do not use): ${untradable.join(", ")}`
      : "",
  ].join("\n");
}

function client(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ComposeError(
      "ANTHROPIC_API_KEY is not set. Add a key from console.anthropic.com to enable this.",
    );
  }
  return new Anthropic();
}

export function composeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Turn a description like "AI exposure but not Tesla" into a buyable slate.
 *
 * The model's picks are treated as a proposal, not as output: unknown or
 * untradable symbols are dropped, duplicates collapsed, the list is capped, and
 * the weights are re-derived here. Whatever the model returns, what leaves this
 * function is a slate that sums to exactly 100% and can be priced.
 */
export async function composeSlate(prompt: string): Promise<ComposeResult> {
  const description = prompt.trim();
  if (description.length < 3) throw new ComposeError("Describe what you want in a few words.");
  if (description.length > 400) throw new ComposeError("Keep the description under 400 characters.");

  const market = await readMarket();

  const response = await client().messages.parse({
    model: "claude-opus-5",
    max_tokens: 2000,
    system: SYSTEM,
    // A constrained mapping over thirteen options: low effort keeps a
    // user-facing route fast without costing quality on a task this bounded.
    output_config: { effort: "low", format: zodOutputFormat(Composition) },
    messages: [
      {
        role: "user",
        content: `Universe of tokenized stocks available right now:\n\n${universe(
          market.tickers,
        )}\n\nThe request: ${description}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new ComposeError("That request could not be composed. Try describing it differently.");
  }

  const parsed = response.parsed_output;
  if (!parsed) throw new ComposeError("The composer returned nothing usable. Try again.");

  return {
    name: parsed.name.slice(0, 32).trim() || "Untitled slate",
    rationale: parsed.rationale.slice(0, 140).trim(),
    ...normalizePicks(parsed.picks, market.tickers),
  };
}

/**
 * Turn the model's proposal into a slate that is guaranteed buyable.
 *
 * Pure and separately tested, because this is the function that has to hold
 * when the model does something unexpected: an invented ticker, a duplicate, a
 * zero weight, nine picks, a stock with no liquidity. Whatever comes in, what
 * comes out sums to exactly 100%, sits inside the position limit, and contains
 * only stocks that can actually be bought right now.
 */
export function normalizePicks(
  picks: Composition["picks"],
  tickers: Ticker[],
): Pick<ComposeResult, "legs" | "reasons" | "dropped"> {
  const bySymbol = new Map(tickers.map((t) => [t.symbol.toLowerCase(), t]));

  const dropped: { symbol: string; reason: string }[] = [];
  const seen = new Set<string>();
  const kept: { ticker: Ticker; weight: number; why: string }[] = [];

  for (const pick of picks) {
    const ticker = bySymbol.get(String(pick?.symbol ?? "").toLowerCase());

    if (!ticker) {
      dropped.push({ symbol: String(pick?.symbol ?? "?"), reason: "not a tokenized stock on Base" });
      continue;
    }
    if (!ticker.tradable) {
      dropped.push({ symbol: ticker.ticker, reason: "no onchain liquidity yet" });
      continue;
    }
    if (seen.has(ticker.symbol)) continue;
    if (kept.length >= MAX_LEGS) {
      dropped.push({ symbol: ticker.ticker, reason: `over the ${MAX_LEGS}-position limit` });
      continue;
    }

    seen.add(ticker.symbol);
    // A non-positive or non-finite weight would poison the apportionment, so it
    // becomes an equal share rather than an error the user has to see.
    const weight = Number(pick.weight);
    kept.push({
      ticker,
      weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
      why: String(pick.why ?? "").slice(0, 60),
    });
  }

  if (kept.length === 0) {
    throw new ComposeError(
      "Nothing in that idea maps to a tokenized stock that is tradeable right now.",
    );
  }

  const shares = apportion(
    kept.map((entry) => entry.weight),
    TOTAL_BPS,
    MIN_LEG_BPS,
  );

  return {
    legs: canonicalize(
      kept.map((entry, index) => ({ symbol: entry.ticker.symbol, bps: shares[index] })),
    ),
    reasons: Object.fromEntries(kept.map((entry) => [entry.ticker.symbol, entry.why])),
    dropped,
  };
}
