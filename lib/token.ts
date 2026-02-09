import { getKeyPair } from "./crypto";

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function signToken(clientId: string, env: Env) {
  const { privateKey } = await getKeyPair(env);
  const ttlSeconds = Number(env.TOKEN_TTL_SECONDS);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const payload = { sub: clientId, exp };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64UrlEncode(payloadBytes);

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    payloadBytes as unknown as BufferSource
  );

  const sigBytes = new Uint8Array(signature);
  const sigB64 = base64UrlEncode(sigBytes);

  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: exp,
  };
}

export async function validateToken(
  token: string,
  env: Env
): Promise<{ valid: boolean; reason?: string; expiresAt?: number }> {
  const { publicKey } = await getKeyPair(env);

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "MALFORMED_TOKEN" };
  }

  const [payloadB64, sigB64] = parts;
  const payloadBytes = base64UrlDecode(payloadB64);
  const sigBytes = base64UrlDecode(sigB64);

  const payloadJson = new TextDecoder().decode(payloadBytes);
  let payload: any;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { valid: false, reason: "MALFORMED_PAYLOAD" };
  }

  if (typeof payload.exp !== "number") {
    return { valid: false, reason: "MISSING_EXP" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    return { valid: false, reason: "EXPIRED", expiresAt: payload.exp };
  }

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    sigBytes as unknown as BufferSource,
    payloadBytes as unknown as BufferSource
  );

  if (!ok) {
    return {
      valid: false,
      reason: "INVALID_SIGNATURE",
      expiresAt: payload.exp,
    };
  }

  return { valid: true, expiresAt: payload.exp };
}
