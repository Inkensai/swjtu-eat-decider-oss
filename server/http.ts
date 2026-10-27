export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    public headers?: Record<string, string>,
  ) { super(message) }
}
export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  })
}
