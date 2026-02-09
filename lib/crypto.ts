import { pemToArrayBuffer } from "./utils";

export async function getKeyPair(env: Env) {
  const privateKeyPem = env.PRIVATE_KEY;
  const publicKeyPem = env.PUBLIC_KEY;

  const privateKeyData = pemToArrayBuffer(privateKeyPem);
  const publicKeyData = pemToArrayBuffer(publicKeyPem);

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyData as unknown as BufferSource,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyData as unknown as BufferSource,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"]
  );

  return { privateKey, publicKey };
}
