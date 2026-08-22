import type { DeepReport, PackageReport, RepoReport } from "./model";

export async function fetchReport(query: string): Promise<PackageReport | RepoReport> {
  return request<PackageReport | RepoReport>(`/api/search?q=${encodeURIComponent(query)}`);
}

export async function fetchDeepReport(query: string, depth?: number): Promise<DeepReport> {
  const suffix = depth === undefined ? "" : `&depth=${depth}`;
  return request<DeepReport>(`/api/deepsearch?q=${encodeURIComponent(query)}${suffix}`);
}

async function request<T>(url: string): Promise<T> {
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

  return body as T;
}
