/**
 * Pre-flight check for the Mini App manifest.
 *
 *   node scripts/verify-manifest.mjs [origin]
 *
 * An invalid manifest does not throw at runtime — the app just quietly fails to
 * appear in Base App, with nothing in any log to say why. `withValidManifest`
 * drops a malformed account association rather than serving it, so "the field
 * is missing" is what a bad signature looks like from the outside.
 *
 * This decodes the association, checks it actually binds the domain being
 * served, and measures every image against the spec.
 */
import sharp from "sharp";

const ORIGIN = (process.argv[2] || "https://slatebaskets.vercel.app").replace(/\/$/, "");
const HOST = new URL(ORIGIN).host;

let failures = 0;
let warnings = 0;

const ok = (label, detail = "") => console.log(`  ok    ${label.padEnd(26)} ${detail}`);
const bad = (label, detail = "") => {
  failures += 1;
  console.log(`  FAIL  ${label.padEnd(26)} ${detail}`);
};
const warn = (label, detail = "") => {
  warnings += 1;
  console.log(`  warn  ${label.padEnd(26)} ${detail}`);
};

function decode(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

console.log(`\nChecking ${ORIGIN}\n`);

const response = await fetch(`${ORIGIN}/.well-known/farcaster.json`, { cache: "no-store" });
if (!response.ok) {
  console.log(`  FAIL  manifest unreachable (HTTP ${response.status})\n`);
  process.exit(1);
}

const manifest = await response.json();
const app = manifest.miniapp ?? manifest.frame;

if (!app) {
  bad("miniapp object", "manifest has neither `miniapp` nor `frame`");
  process.exit(1);
}

// --- Account association -----------------------------------------------------

console.log("Account association");
const association = manifest.accountAssociation;

if (!association) {
  bad("accountAssociation", "absent — sign at farcaster.xyz/~/developers/new");
} else {
  const header = decode(association.header);
  const payload = decode(association.payload);

  if (!header) bad("header", "not base64url JSON");
  else ok("header", `fid ${header.fid ?? "?"} · ${header.type ?? "?"} ${header.key ?? ""}`.trim());

  if (!payload) {
    bad("payload", "not base64url JSON");
  } else if (payload.domain !== HOST) {
    // The single most common publishing failure: signing one domain and
    // serving another. It fails silently, so it is checked explicitly.
    bad("payload.domain", `signed "${payload.domain}", served on "${HOST}"`);
  } else {
    ok("payload.domain", payload.domain);
  }

  if (!association.signature) bad("signature", "empty");
  else ok("signature", `${association.signature.length} chars`);
}

// --- Required and length-capped fields ---------------------------------------

console.log("\nManifest fields");

const REQUIRED = ["version", "name", "homeUrl", "iconUrl"];
for (const field of REQUIRED) {
  if (!app[field]) bad(field, "required and missing");
}
if (app.version !== "1") bad("version", `must be "1", got ${JSON.stringify(app.version)}`);

const LIMITS = {
  name: 32,
  subtitle: 30,
  description: 170,
  tagline: 30,
  ogTitle: 30,
  ogDescription: 100,
};

for (const [field, limit] of Object.entries(LIMITS)) {
  const value = app[field];
  if (typeof value !== "string") continue;
  if (value.length > limit) bad(field, `${value.length}/${limit} characters — will be rejected`);
  else ok(field, `${value.length}/${limit}`);
}

if (Array.isArray(app.tags)) {
  if (app.tags.length > 5) bad("tags", `${app.tags.length} tags, max 5`);
  else {
    const malformed = app.tags.filter((t) => t.length > 20 || /[A-Z\s]/.test(t));
    if (malformed.length) bad("tags", `lowercase, no spaces, ≤20 chars: ${malformed.join(", ")}`);
    else ok("tags", app.tags.join(", "));
  }
}

// Every absolute URL has to sit on the signed domain, or a client fetching the
// icon leaves the verified origin.
for (const field of ["homeUrl", "iconUrl", "splashImageUrl", "heroImageUrl", "ogImageUrl", "webhookUrl"]) {
  const value = app[field];
  if (!value) continue;
  try {
    if (new URL(value).host !== HOST) bad(field, `points off-domain: ${new URL(value).host}`);
  } catch {
    bad(field, `not a valid URL: ${value}`);
  }
}

if (app.canonicalDomain && app.canonicalDomain !== HOST) {
  bad("canonicalDomain", `${app.canonicalDomain} ≠ ${HOST}`);
}

// --- Images -------------------------------------------------------------------

console.log("\nImages");

const IMAGES = [
  { field: "iconUrl", width: 1024, height: 1024, noAlpha: true },
  { field: "splashImageUrl", width: 200, height: 200 },
  { field: "heroImageUrl", width: 1200, height: 630 },
  { field: "ogImageUrl", width: 1200, height: 630 },
];

for (const spec of IMAGES) {
  const url = app[spec.field];
  if (!url) {
    warn(spec.field, "not set");
    continue;
  }

  try {
    const image = await fetch(url, { cache: "no-store" });
    if (!image.ok) {
      bad(spec.field, `HTTP ${image.status}`);
      continue;
    }
    const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata();

    const size = `${meta.width}x${meta.height}`;
    if (meta.width !== spec.width || meta.height !== spec.height) {
      bad(spec.field, `${size}, expected ${spec.width}x${spec.height}`);
    } else if (spec.noAlpha && meta.hasAlpha) {
      // A transparent icon renders as a black box in some clients.
      bad(spec.field, `${size} but has an alpha channel`);
    } else {
      ok(spec.field, `${size} ${meta.format}`);
    }
  } catch (error) {
    bad(spec.field, error instanceof Error ? error.message : String(error));
  }
}

// --- Embed tag ----------------------------------------------------------------

console.log("\nEmbed");

const html = await (await fetch(ORIGIN, { cache: "no-store" })).text();
const embed = html.match(/<meta name="fc:miniapp" content="([^"]*)"/)?.[1];

if (!embed) {
  bad("fc:miniapp", "absent — shared links will not render as a launchable card");
} else {
  try {
    const json = JSON.parse(embed.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    if (json.version !== "1") bad("fc:miniapp version", json.version);
    else if (!json.imageUrl || !json.button?.action?.url) bad("fc:miniapp", "missing imageUrl or button action");
    else ok("fc:miniapp", `"${json.button.title}" -> ${json.button.action.url}`);
  } catch {
    bad("fc:miniapp", "content is not valid JSON");
  }
}

const appId = html.match(/<meta name="base:app_id" content="([^"]*)"/)?.[1];
if (appId) ok("base:app_id", appId);
else warn("base:app_id", "absent — Base's dashboard matches the page by this tag");

console.log(
  failures === 0
    ? `\nReady to publish.${warnings ? ` ${warnings} warning(s).` : ""}\n`
    : `\n${failures} problem(s) to fix before publishing.\n`,
);

process.exit(failures === 0 ? 0 : 1);
