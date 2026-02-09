export async function readJson(request: Request): Promise<any | null> {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function pemToArrayBuffer(pem: string): Uint8Array {
  const lines = pem.trim().split("\n");
  const base64 = lines
    .filter(line => !line.startsWith("-----"))
    .join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
