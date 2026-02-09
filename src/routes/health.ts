export function handleHealth(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
