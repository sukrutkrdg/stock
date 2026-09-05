import { randomUUID } from "node:crypto";
import { sql } from "./db";
import { canonicalize, slateId, type Leg, type Slate, type SlateDraft } from "./slate";

type SlateRow = {
  id: string;
  name: string;
  legs: Leg[];
  creator_address: string | null;
  creator_fid: number | null;
  creator_name: string | null;
  copies: number;
  created_at: string | Date;
};

function toSlate(row: SlateRow): Slate {
  return {
    id: row.id,
    name: row.name,
    legs: canonicalize(row.legs),
    creatorAddress: row.creator_address,
    creatorFid: row.creator_fid,
    creatorName: row.creator_name,
    copies: row.copies,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/**
 * Store a composition, or return the one that already exists.
 *
 * Slate ids are content addresses, so two people building the same basket land
 * on the same row. First writer names it; later writers join it rather than
 * forking a near-duplicate. `copies` is then a real signal instead of noise.
 */
export async function createSlate(draft: SlateDraft): Promise<Slate> {
  const db = sql();
  const id = slateId(draft.legs);
  const legs = canonicalize(draft.legs);

  const rows = (await db`
    insert into slates (id, name, legs, creator_address, creator_fid, creator_name)
    values (
      ${id}, ${draft.name}, ${JSON.stringify(legs)},
      ${draft.creatorAddress?.toLowerCase() ?? null},
      ${draft.creatorFid ?? null},
      ${draft.creatorName ?? null}
    )
    on conflict (id) do update set id = excluded.id
    returning *
  `) as SlateRow[];

  return toSlate(rows[0]);
}

export async function getSlate(id: string): Promise<Slate | null> {
  const db = sql();
  const rows = (await db`select * from slates where id = ${id}`) as SlateRow[];
  return rows[0] ? toSlate(rows[0]) : null;
}

/**
 * The feed. Ranked by holders first, recency second — a slate earns its place
 * by being copied, and a brand-new one still surfaces above an equally-copied
 * older one.
 */
export async function listTrending(limit = 20): Promise<Slate[]> {
  const db = sql();
  const rows = (await db`
    select * from slates
    order by copies desc, created_at desc
    limit ${limit}
  `) as SlateRow[];
  return rows.map(toSlate);
}

export async function listByCreator(address: string, limit = 20): Promise<Slate[]> {
  const db = sql();
  const rows = (await db`
    select * from slates
    where creator_address = ${address.toLowerCase()}
    order by created_at desc
    limit ${limit}
  `) as SlateRow[];
  return rows.map(toSlate);
}

export async function listHeldBy(address: string, limit = 20): Promise<Slate[]> {
  const db = sql();
  const rows = (await db`
    select s.* from slates s
    join slate_holders h on h.slate_id = s.id
    where h.owner = ${address.toLowerCase()}
    order by h.updated_at desc
    limit ${limit}
  `) as SlateRow[];
  return rows.map(toSlate);
}

/**
 * Record a verified buy.
 *
 * Idempotent on the transaction hash, so a client retry after a dropped
 * response cannot double-count. `copies` tracks distinct holders rather than
 * transactions: it moves the first time a wallet buys into a slate and stays
 * put on every top-up, which keeps it an audience number that one enthusiastic
 * user cannot inflate on their own.
 */
export async function recordBuy(args: {
  slateId: string;
  owner: string;
  txHash: string;
  amountUsdc: string;
}): Promise<{ recorded: boolean; firstTime: boolean; copies: number }> {
  const db = sql();
  const owner = args.owner.toLowerCase();
  const txHash = args.txHash.toLowerCase();

  const claimed = (await db`
    insert into buy_events (tx_hash, slate_id, owner, amount_usdc)
    values (${txHash}, ${args.slateId}, ${owner}, ${args.amountUsdc})
    on conflict (tx_hash) do nothing
    returning tx_hash
  `) as { tx_hash: string }[];

  if (claimed.length === 0) {
    const existing = (await db`select copies from slates where id = ${args.slateId}`) as {
      copies: number;
    }[];
    return { recorded: false, firstTime: false, copies: existing[0]?.copies ?? 0 };
  }

  const holder = (await db`
    insert into slate_holders (slate_id, owner, first_tx, total_usdc, buys)
    values (${args.slateId}, ${owner}, ${txHash}, ${args.amountUsdc}, 1)
    on conflict (slate_id, owner) do update set
      total_usdc = slate_holders.total_usdc + ${args.amountUsdc},
      buys       = slate_holders.buys + 1,
      updated_at = now()
    returning buys
  `) as { buys: number }[];

  const firstTime = holder[0]?.buys === 1;

  const rows = (await (firstTime
    ? db`update slates set copies = copies + 1 where id = ${args.slateId} returning copies`
    : db`select copies from slates where id = ${args.slateId}`)) as { copies: number }[];

  return { recorded: true, firstTime, copies: rows[0]?.copies ?? 0 };
}

export type DcaPlan = {
  id: string;
  owner: string;
  fid: number | null;
  slateId: string;
  amountUsdc: string;
  periodDays: number;
  subscriptionId: string | null;
  status: "active" | "paused" | "cancelled";
  nextChargeAt: string;
  lastChargeAt: string | null;
  charges: number;
};

type DcaRow = {
  id: string;
  owner: string;
  fid: number | null;
  slate_id: string;
  amount_usdc: string;
  period_days: number;
  subscription_id: string | null;
  status: DcaPlan["status"];
  next_charge_at: string | Date;
  last_charge_at: string | Date | null;
  charges: number;
};

function toPlan(row: DcaRow): DcaPlan {
  return {
    id: row.id,
    owner: row.owner,
    fid: row.fid,
    slateId: row.slate_id,
    amountUsdc: row.amount_usdc,
    periodDays: row.period_days,
    subscriptionId: row.subscription_id,
    status: row.status,
    nextChargeAt: new Date(row.next_charge_at).toISOString(),
    lastChargeAt: row.last_charge_at ? new Date(row.last_charge_at).toISOString() : null,
    charges: row.charges,
  };
}

/**
 * One active plan per wallet per slate, enforced by a partial unique index.
 * Re-subscribing replaces the terms rather than stacking a second schedule the
 * user would not see coming.
 */
export async function upsertDcaPlan(args: {
  owner: string;
  fid: number | null;
  slateId: string;
  amountUsdc: string;
  periodDays: number;
}): Promise<DcaPlan> {
  const db = sql();
  const rows = (await db`
    insert into dca_plans (id, owner, fid, slate_id, amount_usdc, period_days, next_charge_at)
    values (
      ${randomUUID()}, ${args.owner.toLowerCase()}, ${args.fid}, ${args.slateId},
      ${args.amountUsdc}, ${args.periodDays},
      now() + make_interval(days => ${args.periodDays})
    )
    on conflict (owner, slate_id) where status = 'active'
    do update set
      amount_usdc    = excluded.amount_usdc,
      period_days    = excluded.period_days,
      fid            = excluded.fid,
      next_charge_at = excluded.next_charge_at
    returning *
  `) as DcaRow[];
  return toPlan(rows[0]);
}

export async function listDcaPlans(owner: string): Promise<DcaPlan[]> {
  const db = sql();
  const rows = (await db`
    select * from dca_plans
    where owner = ${owner.toLowerCase()} and status <> 'cancelled'
    order by next_charge_at asc
  `) as DcaRow[];
  return rows.map(toPlan);
}

export async function cancelDcaPlan(owner: string, id: string): Promise<boolean> {
  const db = sql();
  const rows = (await db`
    update dca_plans set status = 'cancelled'
    where id = ${id} and owner = ${owner.toLowerCase()} and status <> 'cancelled'
    returning id
  `) as { id: string }[];
  return rows.length > 0;
}

/** Plans whose next charge has come due, for the scheduled charge run. */
export async function listDuePlans(limit = 100): Promise<DcaPlan[]> {
  const db = sql();
  const rows = (await db`
    select * from dca_plans
    where status = 'active' and next_charge_at <= now()
    order by next_charge_at asc
    limit ${limit}
  `) as DcaRow[];
  return rows.map(toPlan);
}

/** Advance a plan's schedule after its reminder has gone out. */
export async function markReminded(id: string, periodDays: number): Promise<void> {
  const db = sql();
  await db`
    update dca_plans set
      charges        = charges + 1,
      last_charge_at = now(),
      next_charge_at = now() + make_interval(days => ${periodDays})
    where id = ${id}
  `;
}

export type NotificationTarget = { fid: number; token: string; url: string };

export async function saveNotificationToken(target: NotificationTarget): Promise<void> {
  const db = sql();
  await db`
    insert into notification_tokens (fid, token, url)
    values (${target.fid}, ${target.token}, ${target.url})
    on conflict (fid) do update set
      token = excluded.token, url = excluded.url, updated_at = now()
  `;
}

export async function deleteNotificationToken(fid: number): Promise<void> {
  const db = sql();
  await db`delete from notification_tokens where fid = ${fid}`;
}

export async function getNotificationToken(fid: number): Promise<NotificationTarget | null> {
  const db = sql();
  const rows = (await db`
    select fid, token, url from notification_tokens where fid = ${fid}
  `) as NotificationTarget[];
  return rows[0] ?? null;
}
