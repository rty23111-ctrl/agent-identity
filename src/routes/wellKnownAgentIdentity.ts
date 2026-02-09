import { success } from "../../lib/errors";

export async function handleWellKnownAgentIdentity(
  request: Request,
  env: Env
): Promise<Response> {
  const doc = {
    service: "agent-identity",
    version: "1.0.0",
    capabilitiesUrl: "/capabilities",
    endpoints: {
      register: "/api/register",
      token: "/api/token",
      validate: "/api/validate",
      health: "/health",
      capabilities: "/capabilities"
    }
  };

  return success({ discovery: doc });
}
