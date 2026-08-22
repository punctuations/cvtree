import { CvtreeError } from "@/lib/errors";

import type { GithubAdvisory } from "./types";

const GITHUB_API_URL = process.env.GITHUB_API_URL ?? "https://api.github.com";
const USER_AGENT = "cvtree-web/0.1.0";
const PER_PAGE = 100;
const MAX_PAGES = 3;
const TIMEOUT_MS = 15000;

export class GithubUnavailable extends Error {}

function headers(): HeadersInit {
  const value: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": USER_AGENT,
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    value.authorization = `Bearer ${token}`;
  }

  return value;
}

export async function repoExists(owner: string, name: string): Promise<boolean> {
  const response = await request(`/repos/${owner}/${name}`);

  if (response.status === 404) {
    throw new CvtreeError(`github repository ${owner}/${name} was not found`, 404);
  }
  if (!response.ok) {
    throw new GithubUnavailable(await describe(response));
  }

  return true;
}

export async function repoAdvisories(owner: string, name: string): Promise<GithubAdvisory[]> {
  const advisories: GithubAdvisory[] = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await request(
      `/repos/${owner}/${name}/security-advisories?per_page=${PER_PAGE}&page=${page}`,
    );

    if (response.status === 404) {
      return advisories;
    }
    if (!response.ok) {
      throw new GithubUnavailable(await describe(response));
    }

    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) {
      throw new GithubUnavailable("unexpected response format");
    }

    advisories.push(...(body as GithubAdvisory[]));

    if (body.length < PER_PAGE) {
      break;
    }
  }

  return advisories;
}

async function request(path: string): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API_URL}${path}`, {
      headers: headers(),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new GithubUnavailable("request timed out");
    }
    throw new GithubUnavailable("network request failed");
  }
}

async function describe(response: Response): Promise<string> {
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      return process.env.GITHUB_TOKEN
        ? "rate limit reached"
        : "rate limit reached (set GITHUB_TOKEN to raise it)";
    }
  }

  const body = await response.text().catch(() => "");
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") {
      return parsed.message;
    }
  } catch {
    // fall through to the status
  }

  return `HTTP ${response.status}`;
}
