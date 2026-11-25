import type { BusinessUpdateResponse } from './business-update.type';

/** An uploaded file as it contributes to the idempotency request hash. */
export type BusinessIdempotencyFile = {
  path: string;
  originalName: string;
  mimeType: string;
  content: Buffer;
};

/** The caller holds the idempotency lock and must `complete` then `release`. */
export type BusinessIdempotencyContext = {
  kind: 'reserved';
  redisKey: string;
  requestHash: string;
  reservation: string;
};

/** The same request already completed; return its stored response. */
export type BusinessIdempotencyReplay = {
  kind: 'replay';
  response: BusinessUpdateResponse;
};

export type BusinessIdempotencyState =
  BusinessIdempotencyContext | BusinessIdempotencyReplay;
