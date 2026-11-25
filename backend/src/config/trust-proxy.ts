/** Express `trust proxy` value: off, on (trust everything), or a hop count. */
export type TrustProxySetting = boolean | number;

/**
 * Parses `TRUST_PROXY`: `false` (default), `true`, or a non-negative integer number
 * of proxy hops. Anything else is a configuration error, because a wrong value makes
 * `req.ip` (rate limiting, audit) and `req.secure` (cookies) untrustworthy.
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === '' || normalized === 'false') return false;
  if (normalized === 'true') return true;
  if (/^\d+$/.test(normalized)) return Number.parseInt(normalized, 10);
  throw new Error(
    'TRUST_PROXY must be "false", "true" or a non-negative integer hop count',
  );
}
