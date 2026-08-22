export const fieldTextEncoder = new TextEncoder();
export const fieldTextDecoder = new TextDecoder("utf-8", { fatal: true });

export function encodeBase64Url(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64url");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid_base64url");
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(value, "base64url"));
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function sha256Bytes(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(value)));
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  return [...(await sha256Bytes(value))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomFieldBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0);
}

export function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}
