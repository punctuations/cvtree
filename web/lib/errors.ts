export class CvtreeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CvtreeError";
    this.status = status;
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof CvtreeError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  return Response.json({ error: "cvtree could not complete the request" }, { status: 500 });
}
