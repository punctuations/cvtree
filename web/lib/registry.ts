import { CvtreeError } from "./errors";
import type { Ecosystem } from "./model";

const NPM_BASE_URL = process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org";
const CRATES_BASE_URL = process.env.CRATES_REGISTRY_URL ?? "https://crates.io/api/v1";
const USER_AGENT = "cvtree-web/0.1.0";

export async function latestVersion(name: string, ecosystem: Ecosystem): Promise<string> {
  const url =
    ecosystem === "npm"
      ? `${NPM_BASE_URL}/${name}/latest`
      : `${CRATES_BASE_URL}/crates/${encodeURIComponent(name)}`;

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
  const version =
    ecosystem === "npm"
      ? body?.version
      : (body?.crate?.max_stable_version ?? body?.crate?.max_version);

  if (typeof version !== "string") {
    throw fail("the registry did not report a version");
  }

  return version;
}
