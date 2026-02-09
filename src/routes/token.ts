import { readJson } from "../../lib/utils";
import { signToken } from "../../lib/token";

export async function handleToken(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body || !body.clientId) {
    return new Response(JSON.stringify({ error: "clientId required" }), { status: 400 });
  }

  const { token, expiresAt } = await signToken(body.clientId, env);

  return new Response(JSON.stringify({ token, expiresAt }), { status: 200 });
}
