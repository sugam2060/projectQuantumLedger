import { parseTrustProxy } from '../trust-proxy';

describe('parseTrustProxy', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['FALSE', false],
    ['true', true],
    ['0', 0],
    ['1', 1],
    ['3', 3],
  ])('parses %p as %p', (input, expected) => {
    expect(parseTrustProxy(input)).toBe(expected);
  });

  it.each(['yes', '-1', '1.5', 'loopback', '2 hops'])('rejects %p', (input) => {
    expect(() => parseTrustProxy(input)).toThrow('TRUST_PROXY');
  });
});
