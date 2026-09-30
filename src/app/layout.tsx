import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Lexend } from "next/font/google";
import "@fontsource/opendyslexic/latin-400.css";
import "@fontsource/opendyslexic/latin-700.css";
import { AppStoreProvider } from "@/state/AppStore";
import "./globals.css";

/**
 * Lexend, self-hosted through next/font: no request to Google leaves this
 * domain, and the text is present from the first paint. OpenDyslexic ships
 * self-hosted too (@fontsource), so the accessibility choice is real rather
 * than a name in a menu; the system stack remains the third choice. Lexend is
 * the default because it is engineered for reading proficiency — and, now, it
 * is also the brand face of Pocket.
 */
const lexend = Lexend({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-lexend",
});

export const metadata: Metadata = {
  title: {
    default: "Pocket",
    template: "%s · Pocket",
  },
  description:
    "Say it once. Pocket holds it, reminds you, and never lets it go quiet. Capture a thought in seconds, decide later, and nothing you skip is hidden from you.",
  applicationName: "Pocket",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Pocket",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2e4d0" },
    { media: "(prefers-color-scheme: dark)", color: "#2a1018" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-background="cream"
      data-font="lexend"
      className={lexend.variable}
    >
      <body>
        <AppStoreProvider authEnabled={!!(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET)}>{children}</AppStoreProvider>
      </body>
    </html>
  );
}
