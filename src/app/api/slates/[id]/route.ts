import { getSlate } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/slates/[id]">) {
  const { id } = await ctx.params;

  if (!databaseConfigured()) {
    return Response.json({ error: "Slate storage is not configured." }, { status: 503 });
  }

  try {
    const slate = await getSlate(id);
    if (!slate) return Response.json({ error: "No such slate." }, { status: 404 });
    return Response.json({ slate });
  } catch (error) {
    console.error("[slates] read failed", error);
    return Response.json({ error: "Could not load the slate." }, { status: 500 });
  }
}
