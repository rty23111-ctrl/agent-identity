import { readJson } from "../../lib/utils";

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  if (!body || !body.clientId) {
    return new Response(JSON.stringify({ error: "clientId required" }), { status: 400 });
  }

  const id = body.clientId;

  // In v1: no persistence — registration is always accepted
  return new Response(JSON.stringify({ clientId: id }), { status: 201 });
}
