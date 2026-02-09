import { success } from "../../lib/errors";

export async function handleHealth(): Promise<Response> {
  return success({
    status: "ok",
    timestamp: Date.now()
  });
}
