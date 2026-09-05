import { appUrl } from "./env";
import { getNotificationToken, type NotificationTarget } from "./repo";

/**
 * Send a Mini App notification.
 *
 * The host client hands over a per-user `url` + `token` when the user adds the
 * app; we post the notification back to that URL. Nothing can be sent to a user
 * who never added Slate, which is the point — the token *is* the consent.
 */
export type NotificationResult =
  | { ok: true; delivered: number }
  | { ok: false; reason: string };

export async function sendNotification(args: {
  target: NotificationTarget;
  notificationId: string;
  title: string;
  body: string;
  targetUrl?: string;
}): Promise<NotificationResult> {
  const response = await fetch(args.target.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      notificationId: args.notificationId,
      title: args.title.slice(0, 32),
      body: args.body.slice(0, 128),
      targetUrl: args.targetUrl ?? appUrl(),
      tokens: [args.target.token],
    }),
  });

  if (!response.ok) {
    return { ok: false, reason: `Host returned ${response.status}` };
  }

  const result = (await response.json()) as {
    result?: { successfulTokens?: string[]; invalidTokens?: string[]; rateLimitedTokens?: string[] };
  };

  return { ok: true, delivered: result.result?.successfulTokens?.length ?? 0 };
}

export async function notifyFid(args: {
  fid: number;
  notificationId: string;
  title: string;
  body: string;
  targetUrl?: string;
}): Promise<NotificationResult> {
  const target = await getNotificationToken(args.fid);
  if (!target) return { ok: false, reason: "User has not added Slate." };
  return sendNotification({ ...args, target });
}
