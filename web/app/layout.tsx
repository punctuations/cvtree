import type { Metadata } from "next";

import { ConvexClientProvider } from "@/components/ConvexClientProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "cvtree",
  description: "Search a dependency for known vulnerabilities, backed by OSV.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
