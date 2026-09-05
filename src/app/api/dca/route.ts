import { cancelDcaPlan, getSlate, listDcaPlans, upsertDcaPlan } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";
import { isAddress } from "viem";

export const dynamic = "force-dynamic";

const MIN_AMOUNT = 5;
const MAX_AMOUNT = 5_000;
const ALLOWED_PERIODS = [1, 7, 14, 30];

function requireDb(): Response | null {
  return databaseConfigured()
    ? null
    : Response.json({ error: "Scheduling is not configured." }, { status: 503 });
}

export async function GET(request: Request) {
  const unavailable = requireDb();
  if (unavailable) return unavailable;

  const owner = new URL(request.url).searchParams.get("owner");
  if (!owner || !isAddress(owner)) {
    return Response.json({ error: "A wallet address is required." }, { status: 400 });
  }

  try {
    return Response.json({ plans: await listDcaPlans(owner) });
  } catch (error) {
    console.error("[dca] list failed", error);
    return Response.json({ error: "Could not load your schedules." }, { status: 500 });
  }
}

/**
 * Create or replace a recurring buy.
 *
 * Slate schedules the *reminder*, not the transfer: when a plan comes due the
 * user gets a notification that deep-links into a pre-filled buy they sign
 * themselves. Nothing is ever pulled from a wallet without a signature, and
 * Slate never holds a user's funds — which is a deliberate limit, not a missing
 * feature. Fully autonomous execution would mean routing money through an
 * app-controlled wallet, and that is a different product with a different
 * licence.
 */
export async function POST(request: Request) {
  const unavailable = requireDb();
  if (unavailable) return unavailable;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as {
    owner?: string;
    fid?: number;
    slateId?: string;
    amountUsdc?: number;
    periodDays?: number;
  };

  if (!input.owner || !isAddress(input.owner)) {
    return Response.json({ error: "A wallet address is required." }, { status: 400 });
  }
  const amount = Number(input.amountUsdc);
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return Response.json(
      { error: `Pick an amount between $${MIN_AMOUNT} and $${MAX_AMOUNT.toLocaleString()}.` },
      { status: 400 },
    );
  }
  if (!ALLOWED_PERIODS.includes(Number(input.periodDays))) {
    return Response.json({ error: "Choose daily, weekly, biweekly or monthly." }, { status: 400 });
  }

  try {
    const slate = input.slateId ? await getSlate(input.slateId) : null;
    if (!slate) return Response.json({ error: "No such slate." }, { status: 404 });

    const plan = await upsertDcaPlan({
      owner: input.owner,
      fid: Number.isInteger(input.fid) ? Number(input.fid) : null,
      slateId: slate.id,
      amountUsdc: amount.toFixed(6),
      periodDays: Number(input.periodDays),
    });

    return Response.json({ plan }, { status: 201 });
  } catch (error) {
    console.error("[dca] create failed", error);
    return Response.json({ error: "Could not save the schedule." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const unavailable = requireDb();
  if (unavailable) return unavailable;

  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const id = url.searchParams.get("id");

  if (!owner || !isAddress(owner) || !id) {
    return Response.json({ error: "owner and id are required." }, { status: 400 });
  }

  try {
    const cancelled = await cancelDcaPlan(owner, id);
    if (!cancelled) return Response.json({ error: "No such schedule." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[dca] cancel failed", error);
    return Response.json({ error: "Could not cancel the schedule." }, { status: 500 });
  }
}
