/**
 * Small readers used by the `registerAs` factories. Values were already checked by
 * `validateEnv` at startup, so these only convert strings and apply defaults.
 */
export const readString = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

export const readRequiredString = (key: string): string => {
  const value = readString(key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
};

export const readInt = (key: string, defaultValue: number): number => {
  const value = readString(key);
  return value === undefined ? defaultValue : Number.parseInt(value, 10);
};

/** Splits a comma-separated variable into trimmed, non-empty entries. */
export const splitList = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/** True for `scheme://host[:port]` with http or https and nothing after it. */
export const isHttpOrigin = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value.replace(/\/$/, '')
    );
  } catch {
    return false;
  }
};
