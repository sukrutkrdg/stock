import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SafeArea } from "@coinbase/onchainkit/minikit";
import "@coinbase/onchainkit/styles.css";
import "./globals.css";
import { Providers } from "./providers";
import { TabBar } from "@/components/TabBar";
import { appUrl } from "@/lib/env";
import { embedTag } from "@/lib/embed";

/** Registration id issued by base.dev for the Slate Mini App. */
const BASE_APP_ID = "6a382ac597e45029701137da";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: "Slate",
  description: "Build and share baskets of tokenized stocks on Base.",
  openGraph: {
    title: "Slate",
    description: "Build and share baskets of tokenized stocks on Base.",
    images: ["/hero.png"],
  },
  other: {
    // Turns a bare link to the app into a launchable card in the Base App feed.
    "fc:miniapp": embedTag({ title: "Open Slate", url: appUrl() }),
    // Ties this deployment to the app registered on base.dev. Base App reads it
    // to match the page against the entry in its directory; without it the app
    // is just an unrecognised web page to the client.
    "base:app_id": BASE_APP_ID,
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
  // A pinch-zoom inside a webview usually means a mis-tap, not intent.
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-ink text-text min-h-dvh">
        <Providers>
          <SafeArea>
            <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
              <main className="flex-1 pb-24">{children}</main>
              <TabBar />
            </div>
          </SafeArea>
        </Providers>
      </body>
    </html>
  );
}
