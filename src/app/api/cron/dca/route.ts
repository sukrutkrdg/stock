import { appUrl } from "@/lib/env";
import { notifyFid } from "@/lib/notify";
import { getSlate, listDuePlans, markReminded } from "@/lib/repo";
import { databaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Fires every due schedule's reminder. Wired to a Vercel cron in `vercel.json`.
 *
 * The schedule advances whether or not the notification lands — a user who
 * removed the app or turned notifications off should not accumulate a backlog
 * of overdue buys that all fire at once the moment they come back.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  // Vercel signs cron invocations with CRON_SECRET; anything else is a stranger
  // asking us to notify our users on their behalf.
  if (secret && authorization !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!databaseConfigured()) {
    return Response.json({ error: "Scheduling is not configured." }, { status: 503 });
  }

  try {
    const due = await listDuePlans();
    let notified = 0;
    let skipped = 0;

    for (const plan of due) {
      const slate = await getSlate(plan.slateId);
      if (!slate) continue;

      const amount = Number(plan.amountUsdc);

      if (plan.fid !== null) {
        const result = await notifyFid({
          fid: plan.fid,
          notificationId: `dca-${plan.id}-${plan.charges}`,
          title: "Your slate is due",
          body: `$${amount.toFixed(0)} into ${slate.name}. Tap to review and sign.`,
          targetUrl: `${appUrl()}/s/${slate.id}?amount=${amount}&from=schedule`,
        });
        if (result.ok) notified += 1;
        else skipped += 1;
      } else {
        skipped += 1;
      }

      await markReminded(plan.id, plan.periodDays);
    }

    return Response.json({ due: due.length, notified, skipped });
  } catch (error) {
    console.error("[cron/dca] failed", error);
    return Response.json({ error: "Cron run failed." }, { status: 500 });
  }
}
