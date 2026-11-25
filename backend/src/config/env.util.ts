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
