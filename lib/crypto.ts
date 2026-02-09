export async function getKeyPair(env: Env) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(env.PRIVATE_KEY), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const publicKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(env.PUBLIC_KEY), c => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  return { privateKey, publicKey };
}
