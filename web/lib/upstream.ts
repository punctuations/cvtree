export const UPSTREAM_URL = process.env.CVTREE_API_URL ?? "http://localhost:8080";

export const UNREACHABLE = `Could not reach the cvtree API at ${UPSTREAM_URL}. Start it with "cvtree serve".`;

export async function upstream(path: string): Promise<Response> {
  return await fetch(`${UPSTREAM_URL}${path}`, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
}

export async function proxy(path: string): Promise<Response> {
  let response: Response;

  try {
    response = await upstream(path);
  } catch {
    return Response.json({ error: UNREACHABLE }, { status: 502 });
  }

  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
