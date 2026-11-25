import bcrypt from 'bcryptjs';
import { PasswordService } from '../password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies the right password only', async () => {
    const hash = await passwords.hash('Correct-Horse-1');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(passwords.verify(hash, 'Correct-Horse-1')).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
    await expect(passwords.verify(hash, 'wrong')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('accepts a legacy bcrypt hash and asks for a rehash', async () => {
    const legacy = await bcrypt.hash('Old-Password-1', 4);
    await expect(passwords.verify(legacy, 'Old-Password-1')).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
    await expect(passwords.verify(legacy, 'nope')).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it.each(['', 'plain-text', '$argon2id$broken', '$2b$malformed'])(
    'never throws for an unreadable stored hash %p',
    async (stored) => {
      await expect(passwords.verify(stored, 'anything')).resolves.toEqual({
        valid: false,
        needsRehash: false,
      });
    },
  );

  it('spends a real verification for unknown accounts and always fails', async () => {
    await expect(passwords.verifyAgainstDummy('whatever')).resolves.toBe(false);
  });
});
