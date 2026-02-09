export function error(
  code: string,
  message: string,
  meta: Record<string, any> = {}
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, ...meta }
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }
  );
}

export function success(data: Record<string, any> = {}): Response {
  return new Response(
    JSON.stringify({
      ok: true,
      ...data
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
