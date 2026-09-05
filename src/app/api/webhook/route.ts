import { deleteNotificationToken, saveNotificationToken } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Lifecycle events from the host client, declared as `webhookUrl` in the
 * manifest. Adding the app hands over a notification token; removing it or
 * turning notifications off takes it away, and we delete our copy immediately
 * rather than keeping a token the user has revoked.
 *
 * The payload is a JSON Farcaster Signature envelope: `header` and `payload`
 * are base64url JSON. We read the event out of it but do not treat any of it as
 * authorisation — nothing here grants access to a user's funds or data, and the
 * token it carries is only useful for talking to the host's own endpoint.
 */
type Envelope = { header?: string; payload?: string; signature?: string };

type Event =
  | { event: "miniapp_added" | "frame_added"; notificationDetails?: { url: string; token: string } }
  | { event: "miniapp_removed" | "frame_removed" }
  | { event: "notifications_enabled"; notificationDetails?: { url: string; token: string } }
  | { event: "notifications_disabled" };

function decode<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!databaseConfigured()) return Response.json({ ok: true, stored: false });

  let envelope: Envelope;
  try {
    envelope = (await request.json()) as Envelope;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const header = envelope.header ? decode<{ fid?: number }>(envelope.header) : null;
  const event = envelope.payload ? decode<Event>(envelope.payload) : null;
  const fid = Number(header?.fid);

  if (!Number.isInteger(fid) || !event?.event) {
    return Response.json({ error: "Malformed webhook payload." }, { status: 400 });
  }

  try {
    switch (event.event) {
      case "miniapp_added":
      case "frame_added":
      case "notifications_enabled": {
        const details = "notificationDetails" in event ? event.notificationDetails : undefined;
        if (details?.token && details?.url) {
          await saveNotificationToken({ fid, token: details.token, url: details.url });
        }
        break;
      }
      case "miniapp_removed":
      case "frame_removed":
      case "notifications_disabled":
        await deleteNotificationToken(fid);
        break;
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[webhook] failed", error);
    return Response.json({ error: "Could not process the event." }, { status: 500 });
  }
}
