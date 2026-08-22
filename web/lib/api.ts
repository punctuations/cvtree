import type { PackageReport, RepoReport } from "./model";

export async function fetchReport(query: string): Promise<PackageReport | RepoReport> {
  const url = `/api/search?q=${encodeURIComponent(query)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("Could not reach the cvtree API.");
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body as PackageReport | RepoReport;
}
