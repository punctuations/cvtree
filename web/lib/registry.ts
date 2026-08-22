import { CvtreeError } from "./errors";
import type { Ecosystem } from "./model";

const NPM_BASE_URL = process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org";
const CRATES_BASE_URL = process.env.CRATES_REGISTRY_URL ?? "https://crates.io/api/v1";
const PYPI_BASE_URL = process.env.PYPI_REGISTRY_URL ?? "https://pypi.org/pypi";
const USER_AGENT = "cvtree-web/0.1.0";
const REQUEST_TIMEOUT_MS = 15000;

function registryUrl(name: string, ecosystem: Ecosystem): string {
  switch (ecosystem) {
    case "npm":
      return `${NPM_BASE_URL}/${name}/latest`;
    case "crates.io":
      return `${CRATES_BASE_URL}/crates/${encodeURIComponent(name)}`;
    case "PyPI":
      return `${PYPI_BASE_URL}/${encodeURIComponent(name)}/json`;
  }
}

function extractVersion(body: unknown, ecosystem: Ecosystem): unknown {
  switch (ecosystem) {
    case "npm":
      return (body as { version?: unknown })?.version;
    case "crates.io":
      return (
        (body as { crate?: { max_stable_version?: unknown; max_version?: unknown } })?.crate
          ?.max_stable_version ??
        (body as { crate?: { max_version?: unknown } })?.crate?.max_version
      );
    case "PyPI":
      return (body as { info?: { version?: unknown } })?.info?.version;
  }
}

export async function latestVersion(name: string, ecosystem: Ecosystem): Promise<string> {
  const url = registryUrl(name, ecosystem);

  const fail = (detail: string) =>
    new CvtreeError(
      `could not resolve the latest version of ${name} on ${ecosystem}: ${detail}`,
      detail === "package not found" ? 404 : 502,
    );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw fail("network request failed");
  }

  if (response.status === 404) {
    throw fail("package not found");
  }
  if (!response.ok) {
    throw fail(`HTTP ${response.status}`);
  }

  const body = await response.json().catch(() => null);
  const version = extractVersion(body, ecosystem);

  if (typeof version !== "string") {
    throw fail("the registry did not report a version");
  }

  return version;
}
