const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 6;

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(JOIN_CODE_LENGTH));
  let code = "";

  // The 32-character alphabet divides 256 evenly, avoiding modulo bias.
  for (const byte of bytes) {
    code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
  }

  return code;
}

export function normalizeJoinCode(input: string): string {
  const code = input.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    throw new RangeError(
      "Join code must contain exactly six letters or digits.",
    );
  }

  return code;
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  const expirationTime = expiresAt.getTime();
  const currentTime = now.getTime();

  if (!Number.isFinite(expirationTime) || !Number.isFinite(currentTime)) {
    throw new RangeError("Expiration and current time must be valid dates.");
  }

  return currentTime >= expirationTime;
}
