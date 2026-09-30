import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALGO = "aes-256-gcm";

/** AES-256-GCM. Output: base64(iv[12] | tag[16] | ciphertext). */
export function encrypt(plaintext: string, key: Buffer, aad = "jarvis"): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(payload: string, key: Buffer, aad = "jarvis"): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 29) throw new Error("Ungültiger verschlüsselter Wert");
  const decipher = createDecipheriv(ALGO, key, buf.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
