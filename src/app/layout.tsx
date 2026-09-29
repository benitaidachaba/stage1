import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Lexend } from "next/font/google";
import { AppStoreProvider } from "@/state/AppStore";
import "./globals.css";

/**
 * Lexend, self-hosted through next/font: no request to Google leaves this
 * domain, and the text is present from the first paint. OpenDyslexic and the
 * system stack remain choices in settings; Lexend is the default because it is
 * engineered for reading proficiency, which is the point of this app.
 */
const lexend = Lexend({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-lexend",
});

export const metadata: Metadata = {
  title: {
    default: "Small Steps",
    template: "%s · Small Steps",
  },
  description:
    "A to-do app for a brain that will not open a form. Capture a thought in a few seconds, decide later, and nothing you skip is hidden from you.",
  applicationName: "Small Steps",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Small Steps",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#141317" },
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
        <AppStoreProvider>{children}</AppStoreProvider>
      </body>
    </html>
  );
}
