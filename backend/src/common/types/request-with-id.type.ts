import type { Request } from 'express';

/** An Express request after `RequestIdMiddleware` ran. */
export type RequestWithId = Request & { requestId?: string };
