"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

const client = deploymentUrl ? new ConvexReactClient(deploymentUrl) : null;

export const cacheEnabled = client !== null;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  if (!client) {
    return <>{children}</>;
  }

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
