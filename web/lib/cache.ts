import { ConvexHttpClient } from "convex/browser";

import { api } from "@/convex/_generated/api";

import type { DeepReport, PackageReport } from "./model";

const CONVEX_URL = process.env.CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

const MAX_DOCUMENT_BYTES = 900_000;

export type CacheStatus = "hit" | "miss" | "off" | "too-large";

export interface Cached<T> {
  report: T;
  status: CacheStatus;
  fetchedAt: number | null;
}

let client: ConvexHttpClient | null = null;

function convex(): ConvexHttpClient | null {
  if (!CONVEX_URL) {
    return null;
  }
  if (!client) {
    client = new ConvexHttpClient(CONVEX_URL);
  }
  return client;
}

function tooLarge(report: unknown): boolean {
  return JSON.stringify(report).length > MAX_DOCUMENT_BYTES;
}

export async function cachedPackageReport(
  key: string,
  load: () => Promise<PackageReport>,
): Promise<Cached<PackageReport>> {
  const backend = convex();
  if (!backend) {
    return { report: await load(), status: "off", fetchedAt: null };
  }

  const hit = await backend.query(api.packages.get, { key }).catch(() => null);
  if (hit) {
    return { report: hit.report, status: "hit", fetchedAt: hit.fetchedAt };
  }

  const report = await load();

  if (tooLarge(report)) {
    return { report, status: "too-large", fetchedAt: null };
  }

  await backend
    .mutation(api.packages.put, {
      key,
      ecosystem: report.ecosystem,
      name: report.package,
      version: report.version,
      vulnerabilityCount: report.vulnerability_count,
      report,
    })
    .catch(() => undefined);

  return { report, status: "miss", fetchedAt: Date.now() };
}

export async function cachedDeepReport(
  key: string,
  load: () => Promise<DeepReport>,
): Promise<Cached<DeepReport>> {
  const backend = convex();
  if (!backend) {
    return { report: await load(), status: "off", fetchedAt: null };
  }

  const hit = await backend.query(api.deep.get, { key }).catch(() => null);
  if (hit) {
    return { report: hit.report, status: "hit", fetchedAt: hit.fetchedAt };
  }

  const report = await load();

  if (tooLarge(report)) {
    return { report, status: "too-large", fetchedAt: null };
  }

  await backend
    .mutation(api.deep.put, {
      key,
      ecosystem: report.ecosystem,
      name: report.package,
      version: report.version,
      depth: report.requested_depth,
      dependencyCount: report.dependencies,
      vulnerabilityCount: report.vulnerabilities.length,
      report,
    })
    .catch(() => undefined);

  return { report, status: "miss", fetchedAt: Date.now() };
}

export function cacheHeaders(cached: Cached<unknown>): Record<string, string> {
  const headers: Record<string, string> = { "x-cvtree-cache": cached.status };
  if (cached.fetchedAt !== null) {
    headers["x-cvtree-fetched-at"] = new Date(cached.fetchedAt).toISOString();
  }
  return headers;
}
