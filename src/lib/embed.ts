import { appUrl } from "./env";

/**
 * The `fc:miniapp` embed tag.
 *
 * When a Slate link is pasted into a Base App or Farcaster post, the client
 * reads this tag and renders a 3:2 card with a launch button instead of a bare
 * URL. It is the whole reason a shared slate spreads: the post *is* the app.
 */
export function embedTag(args: { title: string; url: string; image?: string }): string {
  return JSON.stringify({
    version: "1",
    imageUrl: args.image ?? `${appUrl()}/hero.png`,
    button: {
      title: args.title.slice(0, 32),
      action: {
        type: "launch_frame",
        name: "Slate",
        url: args.url,
        splashImageUrl: `${appUrl()}/splash.png`,
        splashBackgroundColor: "#0a0b0d",
      },
    },
  });
}
