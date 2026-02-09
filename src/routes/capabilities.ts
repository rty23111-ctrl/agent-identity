export function handleCapabilities(env: Env): Response {
  return new Response(
    JSON.stringify({
      name: "agent-identity",
      version: env.VERSION || "0.1.0",
      ttl: env.TOKEN_TTL_SECONDS,
    }),
    { status: 200 }
  );
}
