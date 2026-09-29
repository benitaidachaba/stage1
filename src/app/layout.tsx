import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppStoreProvider } from "@/state/AppStore";
import "./globals.css";

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
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#17161a" },
  ],
};

/**
 * The document shell.
 *
 * The typeface comes from the operating system rather than a web font: text
 * appears at the same moment the page does, which matters more here than
 * typographic consistency. Everything the reader can change lives in settings
 * and is written onto the root element by the store.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-contrast="default" data-font="system">
      <body>
        <AppStoreProvider>{children}</AppStoreProvider>
      </body>
    </html>
  );
}
