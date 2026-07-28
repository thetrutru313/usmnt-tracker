import { createHash, randomUUID } from "node:crypto";

/**
 * Hash a plaintext token with SHA-256 and return the hex digest.
 * Used to store auth and recovery tokens without keeping the plaintext
 * in the database. Deterministic: same input always produces same output.
 */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Generate a cryptographically random UUID (128-bit) suitable for use as
 * an auth token or recovery token. Returned as the standard hyphenated
 * UUID string form produced by node:crypto's randomUUID().
 */
export function generateToken(): string {
  return randomUUID();
}
