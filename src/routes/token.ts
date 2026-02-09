import { readJson } from "../../lib/utils";
import { signToken } from "../../lib/token";
import { success, error } from "../../lib/errors";

export async function handleToken(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await readJson(request);

  if (!body || !body.clientId) {
    return error("CLIENT_ID_REQUIRED", "clientId is required");
  }

  const { token, expiresAt } = await signToken(body.clientId, env);

  return success({
    token,
    expiresAt
  });
}
