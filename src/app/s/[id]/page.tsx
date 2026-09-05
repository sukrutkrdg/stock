import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSlate } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { embedTag } from "@/lib/embed";
import { SlateView } from "@/components/SlateView";
import type { Slate } from "@/lib/slate";

async function load(id: string): Promise<Slate | null> {
  if (!databaseConfigured()) return null;
  try {
    return await getSlate(id);
  } catch (error) {
    console.error("[slate page] load failed", error);
    return null;
  }
}

/**
 * A shared slate has to arrive in the feed as a card with a launch button, not
 * as a bare link — that is the entire distribution loop. The `fc:miniapp` tag
 * points back at this exact slate, so tapping the card opens the basket the
 * poster was talking about rather than the app's front page.
 */
export async function generateMetadata(props: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const slate = await load(id);
  const title = slate ? slate.name : "Slate";
  const url = `${appUrl()}/s/${id}`;

  return {
    title,
    description: slate
      ? `A basket of ${slate.legs.length} tokenized stocks on Base. ${slate.copies} ${
          slate.copies === 1 ? "holder" : "holders"
        }.`
      : "Baskets of tokenized stocks on Base.",
    openGraph: { title, url },
    other: {
      "fc:miniapp": embedTag({ title: slate ? `Buy ${slate.name}` : "Open Slate", url }),
    },
  };
}

export default async function SlatePage(props: PageProps<"/s/[id]">) {
  const { id } = await props.params;
  const slate = await load(id);
  if (!slate) notFound();

  return <SlateView slate={slate} />;
}
