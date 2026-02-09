import { success } from "../../lib/errors";

export async function handleCapabilities(
  request: Request,
  env: Env
): Promise<Response> {
  const capabilities = {
    service: "agent-identity",
    version: "1.0.0",
    endpoints: {
      register: "/api/register",
      token: "/api/token",
      validate: "/api/validate",
      health: "/health",
      capabilities: "/capabilities",
      discovery: "/.well-known/agent-identity"
    },
    token: {
      algorithm: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      ttlSeconds: Number(env.TOKEN_TTL_SECONDS),
      format: "base64url(payload).base64url(signature)"
    }
  };

  return success({ capabilities });
}
