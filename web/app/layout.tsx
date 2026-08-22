import type { Metadata } from "next";
import { DotGothic16 } from "next/font/google";
import localFont from "next/font/local";

import { ConvexClientProvider } from "@/components/ConvexClientProvider";

import "./globals.css";

const display = localFont({
  src: "./Retrogression/Retrogression-Regular.ttf",
  variable: "--font-display",
  display: "swap",
});

const body = DotGothic16({
  variable: "--font-body",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "cvtree",
  description: "Search a dependency for known vulnerabilities, backed by OSV.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
