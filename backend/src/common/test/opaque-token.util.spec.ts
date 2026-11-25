import {
  generateOpaqueToken,
  hashOpaqueToken,
  isOpaqueTokenShape,
} from '../utils/opaque-token.util';

describe('opaque tokens', () => {
  it('generates unique 32-byte base64url tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, generateOpaqueToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(isOpaqueTokenShape(token)).toBe(true);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('hashes to lower-case hex SHA-256, deterministically', () => {
    const hash = hashOpaqueToken('abc');
    expect(hash).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashOpaqueToken('abc')).toBe(hash);
  });

  it.each([undefined, '', 'short', 'x'.repeat(43) + '!', 42])(
    'rejects %p as a token shape',
    (value) => {
      expect(isOpaqueTokenShape(value)).toBe(false);
    },
  );
});
