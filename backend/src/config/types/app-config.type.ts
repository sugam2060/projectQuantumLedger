import type { TrustProxySetting } from '../trust-proxy';

/** Shape of the `app` config namespace (see `app.config.ts`). */
export type AppConfig = {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  apiPrefix: string;
  /** Public website origin used in emailed links. Optional: features that need it fail with 503. */
  frontendBaseUrl: string | undefined;
  /** Browser origins allowed by CORS (FRONTEND_BASE_URL plus CORS_ALLOWED_ORIGINS). */
  corsOrigins: string[];
  /** Express `trust proxy` setting from TRUST_PROXY. */
  trustProxy: TrustProxySetting;
};
