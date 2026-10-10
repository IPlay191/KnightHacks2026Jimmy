import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { LiveAnnouncerProvider } from "@/components/ui/LiveAnnouncer";
import { SkipLink } from "@/components/ui/SkipLink";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  weight: ["600", "700", "800"],
  display: "swap",
});
const sans = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"], display: "swap" });

// Every page is rendered per request so Next.js can apply the CSP nonce set in src/proxy.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Speech Reviewer", template: "%s · Speech Reviewer" },
  description:
    "Record a practice speech and get AI coaching on pacing, filler words, clarity, and audience fit. Powered by open-source models on Hugging Face.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d17",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-motion="full"
      className={`${display.variable} ${sans.variable} ${mono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-canvas text-text">
        <SkipLink />
        <MotionProvider>
          <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
