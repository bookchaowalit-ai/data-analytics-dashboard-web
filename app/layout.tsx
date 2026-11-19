import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// The font variable sits on <html>: the Dashboard shell tokens live on :root and read it from there.
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

const description = "Summarise a CSV export of events in your browser: events, value, segments and the trend for the last 24 hours, 7 or 30 days. Nothing is uploaded.";

export const metadata: Metadata = {
  title: "Signal Ledger | Bookchaowalit",
  description,
  keywords: ["analytics dashboard", "csv", "bookchaowalit"],
  authors: [{ name: "Bookchaowalit", url: "https://bookchaowalit.com" }],
  creator: "Bookchaowalit",
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "en_US", url: "/", title: "Signal Ledger | Bookchaowalit", description, siteName: "Bookchaowalit" },
  twitter: { card: "summary_large_image", title: "Signal Ledger | Bookchaowalit", description },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
