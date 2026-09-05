"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, Spinner } from "./ui";
import type { Leg } from "@/lib/slate";

export type Composed = {
  name: string;
  rationale: string;
  legs: Leg[];
  reasons: Record<string, string>;
  dropped: { symbol: string; reason: string }[];
};

/**
 * Examples do the explaining. A blank box invites "stocks", which produces a
 * generic basket and teaches the user nothing; these show the two things the
 * composer is actually good at — a thesis, and an exclusion.
 */
const EXAMPLES = [
  "AI infrastructure, but nothing I already own through an index",
  "Everything except Tesla",
  "The companies making money from chips",
  "Split between crypto and big tech",
];

export function Composer({ onComposed }: { onComposed: (result: Composed) => void }) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availability = useQuery({
    queryKey: ["compose", "available"],
    staleTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      const response = await fetch("/api/compose");
      if (!response.ok) return false;
      return (await response.json()).available === true;
    },
  });

  // Nothing is worse than an input that always fails. If the key is missing the
  // composer simply is not there, and the manual builder below is the whole page.
  if (availability.data !== true) return null;

  async function compose(text: string) {
    const description = text.trim();
    if (description.length < 3) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: description }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not compose a slate.");
      onComposed(body as Composed);
      setPrompt("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not compose a slate.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="px-4 pt-5">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <label htmlFor="composer" className="text-[12px] font-semibold uppercase tracking-wide text-faint">
          Describe it instead
        </label>

        <textarea
          id="composer"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            // Enter composes; Shift+Enter is a newline. The box is one or two
            // lines in practice, so requiring a button press is friction.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void compose(prompt);
            }
          }}
          rows={2}
          maxLength={400}
          placeholder="AI exposure, but not Tesla"
          disabled={pending}
          className="mt-2 w-full resize-none bg-transparent text-[16px] leading-snug outline-none placeholder:text-faint disabled:opacity-50"
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] leading-snug text-faint">
            Builds a basket from the 13 tokenized stocks. You can edit everything after.
          </p>
          <Button
            className="h-9 shrink-0 px-4 text-[13px]"
            onClick={() => void compose(prompt)}
            loading={pending}
            disabled={prompt.trim().length < 3}
          >
            {pending ? "Composing…" : "Compose"}
          </Button>
        </div>
      </div>

      {!pending && prompt.trim().length === 0 && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => void compose(example)}
              className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[12px] text-muted transition active:bg-surface"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {pending && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-faint">
          <Spinner /> Reading the market and picking positions…
        </p>
      )}

      {error && (
        <div className="mt-3">
          <Banner tone="error">{error}</Banner>
        </div>
      )}
    </div>
  );
}
