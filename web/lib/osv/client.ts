import { CvtreeError } from "@/lib/errors";
import type { Dependency, Vulnerability } from "@/lib/model";

import { normalizeAll } from "./normalize";
import type { OsvQueryResponse, OsvVulnerability } from "./types";

const OSV_BASE_URL = process.env.OSV_API_URL ?? "https://api.osv.dev";
const MAX_PAGES = 5;
const USER_AGENT = "cvtree-web/0.1.0";

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

    const response = await post("/v1/query", body);
    raw.push(...(response.vulns ?? []));

    if (!response.next_page_token) {
      break;
    }
    pageToken = response.next_page_token;
  }

  return raw;
}

async function post(path: string, body: Record<string, unknown>): Promise<OsvQueryResponse> {
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
    return (await response.json()) as OsvQueryResponse;
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
