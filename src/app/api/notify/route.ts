import { sendNotification } from "@/lib/notify";
import { getNotificationToken, saveNotificationToken } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * The proxy MiniKit's `useNotification` posts to.
 *
 * It exists because the host's notification endpoint is cross-origin: the
 * browser cannot reach it directly, and the per-user token should not be
 * sitting in client code anyway. The client sends what it knows; the server
 * prefers the token it already stored, and falls back to the one in the request
 * context the first time a user acts before the webhook has landed.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const input = body as {
    fid?: number;
    notification?: {
      notificationId?: string;
      notificationDetails?: { url: string; token: string } | null;
      title?: string;
      body?: string;
    };
  };

  const fid = Number(input.fid);
  const notification = input.notification;
  if (!Number.isInteger(fid) || !notification?.title || !notification?.body) {
    return Response.json({ error: "fid, title and body are required." }, { status: 400 });
  }

  try {
    let target = databaseConfigured() ? await getNotificationToken(fid) : null;

    const inline = notification.notificationDetails;
    if (!target && inline?.url && inline?.token) {
      target = { fid, token: inline.token, url: inline.url };
      if (databaseConfigured()) await saveNotificationToken(target);
    }

    if (!target) {
      return Response.json({ error: "Add Slate to enable notifications." }, { status: 404 });
    }

    const result = await sendNotification({
      target,
      notificationId: notification.notificationId ?? crypto.randomUUID(),
      title: notification.title,
      body: notification.body,
    });

    if (!result.ok) return Response.json({ error: result.reason }, { status: 502 });
    return Response.json(result);
  } catch (error) {
    console.error("[notify] failed", error);
    return Response.json({ error: "Could not send the notification." }, { status: 500 });
  }
}
