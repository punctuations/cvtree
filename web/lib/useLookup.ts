"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { fetchReport } from "./api";
import { isRepoReport, type PackageReport, type RepoReport } from "./model";
import { cachePackage, getCachedPackage } from "./convexFunctions";
import { cacheKey, parseQuery } from "./spec";

const CACHE_READ_TIMEOUT_MS = 2500;

export type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: PackageReport | RepoReport; cached: boolean }
  | { status: "error"; message: string };

export interface Lookup {
  state: LookupState;
  search: (query: string) => void;
}

interface Request {
  query: string;
  id: number;
}

function useRequest() {
  const [request, setRequest] = useState<Request | null>(null);

  const search = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed) {
      setRequest((previous) => ({ query: trimmed, id: (previous?.id ?? 0) + 1 }));
    }
  }, []);

  return { request, search };
}

export function useDirectLookup(): Lookup {
  const { request, search } = useRequest();
  const [result, setResult] = useState<{ id: number; state: LookupState } | null>(null);

  useEffect(() => {
    if (!request) {
      return;
    }

    let cancelled = false;

    fetchReport(request.query)
      .then((report) => {
        if (!cancelled) {
          setResult({ id: request.id, state: { status: "ready", report, cached: false } });
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setResult({ id: request.id, state: { status: "error", message: error.message } });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  if (!request) {
    return { state: { status: "idle" }, search };
  }

  if (result && result.id === request.id) {
    return { state: result.state, search };
  }

  return { state: { status: "loading" }, search };
}

export function useCachedLookup(): Lookup {
  const { request, search } = useRequest();
  const [fetched, setFetched] = useState<{ id: number; state: LookupState } | null>(null);
  const [cacheReadExpired, setCacheReadExpired] = useState<number | null>(null);

  const parsed = request ? parseQuery(request.query) : null;
  const key =
    parsed?.ok && parsed.query.kind === "package" && parsed.query.version
      ? cacheKey(parsed.query.ecosystem ?? "npm", parsed.query.name, parsed.query.version)
      : null;

  const cached = useQuery(getCachedPackage, key ? { key } : "skip");
  const writeToCache = useMutation(cachePackage);

  useEffect(() => {
    if (!request || !key) {
      return;
    }

    const timer = setTimeout(() => setCacheReadExpired(request.id), CACHE_READ_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [request, key]);

  useEffect(() => {
    const waitingForCache =
      key !== null && cached === undefined && cacheReadExpired !== request?.id;

    if (!request || waitingForCache || cached) {
      return;
    }

    let cancelled = false;

    fetchReport(request.query)
      .then((report) => {
        if (cancelled) {
          return;
        }
        setFetched({ id: request.id, state: { status: "ready", report, cached: false } });
        if (isRepoReport(report)) {
          return;
        }
        void writeToCache({
          key: cacheKey(report.ecosystem, report.package, report.version),
          ecosystem: report.ecosystem,
          name: report.package,
          version: report.version,
          vulnerabilityCount: report.vulnerability_count,
          report,
        }).catch(() => undefined);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setFetched({ id: request.id, state: { status: "error", message: error.message } });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [request, key, cached, cacheReadExpired, writeToCache]);

  if (!request) {
    return { state: { status: "idle" }, search };
  }

  if (fetched && fetched.id === request.id) {
    return { state: fetched.state, search };
  }

  if (cached) {
    return {
      state: { status: "ready", report: cached.report as PackageReport, cached: true },
      search,
    };
  }

  return { state: { status: "loading" }, search };
}
