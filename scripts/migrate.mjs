/**
 * Creates the Slate schema. Idempotent — safe to re-run on every deploy.
 *
 *   npx dotenv -e .env.local -- node scripts/migrate.mjs
 *
 * (drizzle-kit and plain node scripts do not read .env.local the way Next does,
 * so the env file has to be passed in explicitly.)
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local --yes` first.");
  process.exit(1);
}

const sql = neon(url);

const statements = [
  `create table if not exists slates (
     id                text primary key,
     name              text not null,
     legs              jsonb not null,
     creator_address   text,
     creator_fid       integer,
     creator_name      text,
     copies            integer not null default 0,
     created_at        timestamptz not null default now()
   )`,
  // Unlisting is a soft hide, never a delete. Three tables cascade from
  // `slates`, and one of them — buy_events — is what makes recording a buy
  // idempotent; dropping those rows would let old transaction hashes be
  // replayed to re-inflate a holder count. A hidden row keeps holders, keeps
  // shared links working, and keeps that guard intact.
  `alter table slates add column if not exists hidden_at timestamptz`,
  `drop index if exists slates_trending_idx`,
  `create index if not exists slates_trending_idx
     on slates (copies desc, created_at desc) where hidden_at is null`,
  `create index if not exists slates_creator_idx on slates (creator_address)`,

  // One row per wallet per slate: a wallet holding a slate counts once, however
  // many times they top it up. That keeps `copies` an audience number rather
  // than a transaction count that a single user could inflate on their own.
  `create table if not exists slate_holders (
     slate_id     text not null references slates(id) on delete cascade,
     owner        text not null,
     first_tx     text,
     total_usdc   numeric(20,6) not null default 0,
     buys         integer not null default 0,
     created_at   timestamptz not null default now(),
     updated_at   timestamptz not null default now(),
     primary key (slate_id, owner)
   )`,

  // Every recorded buy, keyed by its transaction hash. The primary key is what
  // makes recording idempotent: replaying a hash cannot inflate a slate's
  // holder count, and a client that retries after a timeout is harmless.
  `create table if not exists buy_events (
     tx_hash      text primary key,
     slate_id     text not null references slates(id) on delete cascade,
     owner        text not null,
     amount_usdc  numeric(20,6) not null default 0,
     created_at   timestamptz not null default now()
   )`,
  `create index if not exists buy_events_owner_idx on buy_events (owner, created_at desc)`,

  `create table if not exists dca_plans (
     id               text primary key,
     owner            text not null,
     fid              integer,
     slate_id         text not null references slates(id) on delete cascade,
     amount_usdc      numeric(20,6) not null,
     period_days      integer not null,
     -- Reserved for a future Spend Permission id, so a plan created today can
     -- graduate to fully autonomous execution without a migration.
     subscription_id  text,
     status           text not null default 'active',
     next_charge_at   timestamptz not null,
     last_charge_at   timestamptz,
     charges          integer not null default 0,
     created_at       timestamptz not null default now()
   )`,
  `create index if not exists dca_due_idx on dca_plans (status, next_charge_at)`,

  // Rate-limit counters. `/api/compose` spends money per call and needs no
  // credential to reach, so the ceiling has to live somewhere every serverless
  // instance can see — an in-process counter would grant its full allowance
  // once per instance.
  `create table if not exists rate_limits (
     bucket      text primary key,
     hits        integer not null default 0,
     expires_at  timestamptz not null
   )`,
  `create index if not exists rate_limits_expiry_idx on rate_limits (expires_at)`,

  // Notification credentials handed over when a user adds the Mini App. Keyed
  // by fid because that is the identity the host client speaks; a user may hold
  // several wallets but has exactly one place to be notified.
  `create table if not exists notification_tokens (
     fid         integer primary key,
     token       text not null,
     url         text not null,
     updated_at  timestamptz not null default now()
   )`,
  `create unique index if not exists dca_owner_slate_idx
     on dca_plans (owner, slate_id) where status = 'active'`,
];

for (const statement of statements) {
  // `sql` is a tagged-template function in the Neon driver; a plain DDL string
  // with no interpolation has to go through `sql.query` instead.
  await sql.query(statement);
  console.log(`ok  ${statement.trim().split("\n")[0].slice(0, 72)}`);
}

console.log("\nSchema is up to date.");
