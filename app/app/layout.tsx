import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import { ConvexClientProvider } from "@/components/ConvexClientProvider";

import "./globals.css";

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cvtree",
  description: "Search a dependency for known vulnerabilities, backed by OSV.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={mono.variable}>
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
