export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(key: CryptoKey, obj: unknown): Promise<{ nonce: string; blob: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, data);
  return { nonce: b64(nonce), blob: b64(new Uint8Array(ct)) };
}

export async function decryptJson<T>(key: CryptoKey, nonceB64: string, blobB64: string): Promise<T> {
  const nonce = ub64(nonceB64);
  const blob = ub64(blobB64);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, blob);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(pt)));
}

export function b64(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8));
}

export function ub64(s: string): Uint8Array {
  return new Uint8Array(atob(s).split("").map(c => c.charCodeAt(0)));
}
