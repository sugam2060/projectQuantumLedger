const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
};

/**
 * Parses a short duration such as `15m`, `900s`, `12h` or `30d` (a bare number
 * means seconds) into seconds. Throws for anything else, so a bad env value fails
 * startup instead of producing a token with a surprising lifetime.
 */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value.trim());
  if (!match) {
    throw new Error(`"${value}" is not a duration like 15m, 12h or 30d`);
  }
  const seconds = Number(match[1]) * UNIT_SECONDS[match[2] || 's'];
  if (seconds <= 0) {
    throw new Error(`"${value}" must be a positive duration`);
  }
  return seconds;
}
