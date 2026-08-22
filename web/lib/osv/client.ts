import { CvtreeError } from "@/lib/errors";
import type { Dependency, Vulnerability } from "@/lib/model";
import { mapWithConcurrency } from "@/lib/pool";

import { normalizeAll } from "./normalize";
import type { OsvBatchResponse, OsvQueryResponse, OsvVulnerability } from "./types";

const OSV_BASE_URL = process.env.OSV_API_URL ?? "https://api.osv.dev";
const MAX_PAGES = 5;
const BATCH_SIZE = 500;
const DETAIL_CONCURRENCY = 12;
const USER_AGENT = "cvtree-web/0.1.0";
const REQUEST_TIMEOUT_MS = 30000;

export async function queryOsv(dependency: Dependency): Promise<Vulnerability[]> {
  const raw = await queryAll({
    package: { name: dependency.name, ecosystem: dependency.ecosystem },
    version: dependency.version,
  });

  return normalizeAll(raw, dependency);
}

export async function queryOsvRepo(repoUrl: string): Promise<OsvVulnerability[]> {
  return queryAll({ package: { name: repoUrl, ecosystem: "GIT" } });
}

async function queryAll(query: Record<string, unknown>): Promise<OsvVulnerability[]> {
  const raw: OsvVulnerability[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body: Record<string, unknown> = { ...query };
    if (pageToken) {
      body.page_token = pageToken;
    }

    const response = await post<OsvQueryResponse>("/v1/query", body);
    raw.push(...(response.vulns ?? []));

    if (!response.next_page_token) {
      break;
    }
    pageToken = response.next_page_token;
  }

  return raw;
}

export async function queryOsvBatch(dependencies: Dependency[]): Promise<Vulnerability[][]> {
  if (dependencies.length === 0) {
    return [];
  }

  const ids = await idsFor(dependencies);
  const unique = new Set(ids.flat());
  const details = await detailsFor([...unique]);

  return dependencies.map((dependency, index) => {
    const raw = ids[index]
      .map((id) => details.get(id))
      .filter((item): item is OsvVulnerability => item !== undefined);
    return normalizeAll(raw, dependency);
  });
}

export async function countOsvBatch(
  packages: { name: string; ecosystem: string }[],
): Promise<number[]> {
  const counts: number[] = [];

  for (let start = 0; start < packages.length; start += BATCH_SIZE) {
    const chunk = packages.slice(start, start + BATCH_SIZE);
    const queries = chunk.map((entry) => ({
      package: { name: entry.name, ecosystem: entry.ecosystem },
    }));

    const response = await post<OsvBatchResponse>("/v1/querybatch", { queries });

    for (let index = 0; index < chunk.length; index += 1) {
      counts.push((response.results?.[index]?.vulns ?? []).length);
    }
  }

  return counts;
}

async function idsFor(dependencies: Dependency[]): Promise<string[][]> {
  const ids: string[][] = [];

  for (let start = 0; start < dependencies.length; start += BATCH_SIZE) {
    const chunk = dependencies.slice(start, start + BATCH_SIZE);
    const queries = chunk.map((dependency) => ({
      package: { name: dependency.name, ecosystem: dependency.ecosystem },
      version: dependency.version,
    }));

    const response = await post<OsvBatchResponse>("/v1/querybatch", { queries });

    for (let index = 0; index < chunk.length; index += 1) {
      ids.push((response.results?.[index]?.vulns ?? []).map((vuln) => vuln.id));
    }
  }

  return ids;
}

async function detailsFor(ids: string[]): Promise<Map<string, OsvVulnerability>> {
  const fetched = await mapWithConcurrency(ids, DETAIL_CONCURRENCY, (id) => vulnerability(id));
  return new Map(fetched.map((raw) => [raw.id, raw]));
}

async function vulnerability(id: string): Promise<OsvVulnerability> {
  let response: Response;

  try {
    response = await fetch(`${OSV_BASE_URL}/v1/vulns/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CvtreeError("failed to query OSV: network request failed", 502);
  }

  if (!response.ok) {
    throw new CvtreeError(
      `failed to query OSV: HTTP ${response.status} for advisory ${id}`,
      502,
    );
  }

  try {
    return (await response.json()) as OsvVulnerability;
  } catch {
    throw new CvtreeError("failed to query OSV: unexpected response format", 502);
  }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${OSV_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CvtreeError("failed to query OSV: network request failed", 502);
  }

  if (!response.ok) {
    const detail = await describe(response);
    throw new CvtreeError(
      `failed to query OSV: HTTP ${response.status} from api.osv.dev: ${detail}`,
      502,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new CvtreeError("failed to query OSV: unexpected response format", 502);
  }
}

async function describe(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") {
      return parsed.message;
    }
  } catch {
    // fall through to the raw body
  }

  return body.slice(0, 200);
}
