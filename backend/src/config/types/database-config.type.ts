/** Shape of the `database` config namespace (see `database.config.ts`). */
export type DatabaseConfig = {
  /** Runtime connection string (non-owner `fortis_app` role). */
  url: string;
  pool: {
    max: number;
    min: number;
    idleTimeoutMs: number;
    connectionTimeoutMs: number;
  };
};
