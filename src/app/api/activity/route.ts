import { isAddress } from "viem";
import { listActivity } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!databaseConfigured()) return Response.json({ activity: [] });

  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner || !isAddress(owner)) {
    return Response.json({ error: "A wallet address is required." }, { status: 400 });
  }

  try {
    return Response.json({ activity: await listActivity(owner) });
  } catch (error) {
    console.error("[activity] read failed", error);
    return Response.json({ error: "Could not load your activity." }, { status: 500 });
  }
}
