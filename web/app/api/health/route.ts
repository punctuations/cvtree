import { UNREACHABLE, UPSTREAM_URL, upstream } from "@/lib/upstream";

export async function GET() {
  try {
    const response = await upstream("/api/health");

    if (!response.ok) {
      return Response.json(
        { status: "degraded", upstream: UPSTREAM_URL, error: `HTTP ${response.status}` },
        { status: 502 },
      );
    }

    return Response.json({ status: "ok", upstream: UPSTREAM_URL, source: "OSV" });
  } catch {
    return Response.json(
      { status: "degraded", upstream: UPSTREAM_URL, error: UNREACHABLE },
      { status: 502 },
    );
  }
}
