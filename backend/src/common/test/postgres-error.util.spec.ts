import { postgresErrorCode } from '../utils/postgres-error.util';

describe('postgresErrorCode', () => {
  it('reads the code of a pg error', () => {
    expect(postgresErrorCode({ code: '23505' })).toBe('23505');
  });

  it('reads the code of a driver error wrapped in cause', () => {
    expect(postgresErrorCode({ cause: { code: '42501' } })).toBe('42501');
  });

  it.each([undefined, null, 'boom', new Error('x'), { code: 23505 }])(
    'returns undefined for %p',
    (value) => {
      expect(postgresErrorCode(value)).toBeUndefined();
    },
  );
});
