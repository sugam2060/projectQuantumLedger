/** Shape of the `app` config namespace (see `app.config.ts`). */
export type AppConfig = {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  /** Public website origin used in emailed links. Optional: features that need it fail with 503. */
  frontendBaseUrl: string | undefined;
};
