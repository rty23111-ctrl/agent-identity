import { readJson } from "../../lib/utils";
import { validateToken } from "../../lib/token";

export async function handleValidate(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body || !body.token) {
    return new Response(JSON.stringify({ error: "token required" }), { status: 400 });
  }

  const result = await validateToken(body.token, env);

  return new Response(JSON.stringify(result), {
    status: result.valid ? 200 : 401,
  });
}
