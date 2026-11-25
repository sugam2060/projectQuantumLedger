import { parseDurationSeconds } from '../duration';

describe('parseDurationSeconds', () => {
  it.each([
    ['900', 900],
    ['900s', 900],
    ['15m', 900],
    ['12h', 43_200],
    ['30d', 2_592_000],
  ])('parses %s', (input, seconds) => {
    expect(parseDurationSeconds(input)).toBe(seconds);
  });

  it.each(['', '0', '15 minutes', '1w', '-5m'])('rejects %p', (input) => {
    expect(() => parseDurationSeconds(input)).toThrow();
  });
});
