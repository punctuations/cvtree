import type { Metadata } from "next";

import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { MotionProvider } from "@/components/MotionProvider";
import { ToastProvider } from "@/components/ToastProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "cvtree",
  description: "Search a dependency for known vulnerabilities, backed by OSV.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <MotionProvider>
          <ConvexClientProvider>
            <ToastProvider>{children}</ToastProvider>
          </ConvexClientProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
