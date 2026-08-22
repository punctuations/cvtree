import { makeFunctionReference } from "convex/server";

import type { PackageReport } from "./api";

export interface CachedPackage {
  report: PackageReport;
  fetchedAt: number;
}

export interface CacheEntryArgs extends Record<string, unknown> {
  key: string;
  ecosystem: string;
  name: string;
  version: string;
  vulnerabilityCount: number;
  report: PackageReport;
}

export const getCachedPackage = makeFunctionReference<
  "query",
  { key: string },
  CachedPackage | null
>("packages:get");

export const cachePackage = makeFunctionReference<"mutation", CacheEntryArgs, string>(
  "packages:put",
);
