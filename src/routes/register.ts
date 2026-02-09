import { readJson } from "../../lib/utils";
import { success, error } from "../../lib/errors";

export async function handleRegister(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await readJson(request);

  if (!body || !body.clientId) {
    return error("CLIENT_ID_REQUIRED", "clientId is required");
  }

  return success({
    clientId: body.clientId,
    registered: true
  });
}
