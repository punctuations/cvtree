"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchDeepReport } from "./api";
import type { DeepReport } from "./model";

export type DeepLookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; report: DeepReport }
  | { status: "error"; message: string };

export interface DeepLookup {
  state: DeepLookupState;
  search: (query: string, depth: number) => void;
}

interface Request {
  query: string;
  depth: number;
  id: number;
}

export function useDeepLookup(): DeepLookup {
  const [request, setRequest] = useState<Request | null>(null);
  const [result, setResult] = useState<{ id: number; state: DeepLookupState } | null>(null);

  const search = useCallback((query: string, depth: number) => {
    const trimmed = query.trim();
    if (trimmed) {
      setRequest((previous) => ({ query: trimmed, depth, id: (previous?.id ?? 0) + 1 }));
    }
  }, []);

  useEffect(() => {
    if (!request) {
      return;
    }

    let cancelled = false;

    fetchDeepReport(request.query, request.depth)
      .then((report) => {
        if (!cancelled) {
          setResult({ id: request.id, state: { status: "ready", report } });
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
