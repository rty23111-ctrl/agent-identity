import { readJson } from "../../lib/utils";
import { validateToken } from "../../lib/token";
import { success, error } from "../../lib/errors";

export async function handleValidate(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await readJson(request);

  if (!body || !body.token) {
    return error("TOKEN_REQUIRED", "token is required");
  }

  const result = await validateToken(body.token, env);

  if (!result.valid) {
    return error(result.reason ?? "INVALID_TOKEN", "Token validation failed", {
      expiresAt: result.expiresAt
    });
  }

  return success({
    valid: true,
    expiresAt: result.expiresAt
  });
}
