import { getKeyPair } from "./crypto";

export async function signToken(clientId: string, env: Env) {
  const { privateKey } = await getKeyPair(env);

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Number(env.TOKEN_TTL_SECONDS);

  const payload = JSON.stringify({ cid: clientId, iat, exp });
  const encoded = new TextEncoder().encode(payload);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoded
  );

  const token = btoa(payload) + "." + btoa(String.fromCharCode(...new Uint8Array(signature)));

  return { token, expiresAt: exp };
}

export async function validateToken(token: string, env: Env) {
  const { publicKey } = await getKeyPair(env);

  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return { valid: false, reason: "Malformed token" };

  const payloadJson = atob(payloadB64);
  const payload = JSON.parse(payloadJson);

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { valid: false, reason: "Expired", expiresAt: payload.exp };

  const signature = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
  const encodedPayload = new TextEncoder().encode(payloadJson);

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    encodedPayload
  );

  return ok
    ? { valid: true, expiresAt: payload.exp }
    : { valid: false, reason: "Invalid signature" };
}
