import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import type { Response } from 'express';
import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
} from '../middleware/request-id.middleware';
import type { RequestWithId } from '../types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function run(incoming?: string) {
  const request = {
    headers: incoming === undefined ? {} : { [REQUEST_ID_HEADER]: incoming },
  } as unknown as RequestWithId;
  const setHeader = jest.fn();
  const response = { setHeader } as unknown as Response;
  const next = jest.fn();
  new RequestIdMiddleware().use(request, response, next);
  return { request, setHeader, next };
}

describe('RequestIdMiddleware', () => {
  it('generates an id when the client sent none', () => {
    const { request, setHeader, next } = run();
    expect(request.requestId).toMatch(UUID);
    expect(request.headers[REQUEST_ID_HEADER]).toBe(request.requestId);
    expect(setHeader).toHaveBeenCalledWith('X-Request-Id', request.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('keeps a safe client-supplied id', () => {
    const { request } = run('abc-123_DEF.9');
    expect(request.requestId).toBe('abc-123_DEF.9');
  });

  it.each(['has spaces', 'x'.repeat(129), 'bad\nline', '<script>'])(
    'replaces an unsafe id %p',
    (value) => {
      const { request } = run(value);
      expect(request.requestId).toMatch(UUID);
    },
  );
});
