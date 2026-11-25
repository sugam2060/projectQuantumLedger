import { createHash, randomBytes } from 'node:crypto';
import { createPlatformUser, createUser } from './helpers/factories';
import { asApp, closePools, owner, truncateAll } from './helpers/test-db';

const newHash = (): string =>
  createHash('sha256').update(randomBytes(32)).digest('hex');

type RotateRow = {
  outcome: string;
  session_id: string | null;
  user_id: string | null;
};

async function createSession(
  actor: { userId?: string; platformUserId?: string },
  hash: string,
  opts: { persistent?: boolean; expiresInSeconds?: number } = {},
): Promise<string> {
  const settings: Record<string, string> = {};
  if (actor.userId) settings['app.user_id'] = actor.userId;
  if (actor.platformUserId)
    settings['app.platform_user_id'] = actor.platformUserId;
  return asApp(settings, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT app.auth_create_session($1, $2, $3, 'desktop', NULL, $4, 'jest', '127.0.0.1',
              now() + make_interval(secs => $5)) AS id`,
      [
        actor.userId ?? null,
        actor.platformUserId ?? null,
        hash,
        opts.persistent ?? false,
        opts.expiresInSeconds ?? 3600,
      ],
    );
    await client.query('COMMIT');
    await client.query('BEGIN');
    return rows[0].id;
  });
}

async function rotate(oldHash: string, nextHash: string): Promise<RotateRow> {
  return asApp({}, async (client) => {
    const { rows } = await client.query<RotateRow>(
      `SELECT outcome, session_id, user_id
         FROM app.auth_rotate_session($1, $2, 'jest', '127.0.0.1',
                                      interval '30 days', interval '12 hours')`,
      [oldHash, nextHash],
    );
    await client.query('COMMIT');
    await client.query('BEGIN');
    return rows[0];
  });
}

async function activeSessionCount(userId: string): Promise<number> {
  const { rows } = await owner().query<{ count: string }>(
    'SELECT count(*) FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return Number(rows[0].count);
}

describe('session SQL functions', () => {
  beforeEach(truncateAll);
  afterAll(closePools);

  it('refuses to create a session for another actor than the request context', async () => {
    const user = await createUser();
    const other = await createUser();
    await expect(
      asApp({ 'app.user_id': other.id }, (client) =>
        client.query(
          `SELECT app.auth_create_session($1, NULL, $2, 'web', NULL, false, NULL, NULL, now() + interval '1 hour')`,
          [user.id, newHash()],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('rotates a live token into a new session', async () => {
    const user = await createUser();
    const first = newHash();
    await createSession({ userId: user.id }, first, { persistent: true });

    const second = newHash();
    const result = await rotate(first, second);

    expect(result).toMatchObject({ outcome: 'rotated', user_id: user.id });
    const { rows } = await owner().query<{
      refresh_token_hash: string;
      revoked: boolean;
      rotated: boolean;
      persistent: boolean;
      long_lived: boolean;
    }>(
      `SELECT refresh_token_hash, revoked_at IS NOT NULL AS revoked,
              rotated_at IS NOT NULL AS rotated, persistent,
              expires_at > now() + interval '29 days' AS long_lived
         FROM sessions WHERE user_id = $1 ORDER BY created_at`,
      [user.id],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        refresh_token_hash: first,
        revoked: true,
        rotated: true,
      }),
      expect.objectContaining({
        refresh_token_hash: second,
        revoked: false,
        persistent: true,
        long_lived: true,
      }),
    ]);
  });

  it('treats a replayed rotated token as reuse and revokes every session of the user', async () => {
    const user = await createUser();
    const first = newHash();
    await createSession({ userId: user.id }, first);
    await createSession({ userId: user.id }, newHash()); // another device
    const second = newHash();
    await rotate(first, second);
    expect(await activeSessionCount(user.id)).toBe(2);

    const replay = await rotate(first, newHash());

    expect(replay.outcome).toBe('reuse');
    expect(await activeSessionCount(user.id)).toBe(0);
  });

  it('treats a logged-out token as plain invalid and leaves other sessions alone', async () => {
    const user = await createUser();
    const loggedOut = newHash();
    await createSession({ userId: user.id }, loggedOut);
    await createSession({ userId: user.id }, newHash());
    const revoked = await asApp({}, async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT app.auth_revoke_session($1) AS ok',
        [loggedOut],
      );
      await client.query('COMMIT');
      await client.query('BEGIN');
      return rows[0].ok;
    });
    expect(revoked).toBe(true);

    expect((await rotate(loggedOut, newHash())).outcome).toBe('invalid');
    expect(await activeSessionCount(user.id)).toBe(1);
  });

  it('rejects unknown and expired tokens', async () => {
    const user = await createUser();
    const expired = newHash();
    await createSession({ userId: user.id }, expired, { expiresInSeconds: -1 });

    expect((await rotate(newHash(), newHash())).outcome).toBe('invalid');
    expect((await rotate(expired, newHash())).outcome).toBe('invalid');
  });

  it('refuses to rotate for a disabled account and revokes that session', async () => {
    const user = await createUser();
    const token = newHash();
    await createSession({ userId: user.id }, token);
    await owner().query("UPDATE users SET status = 'disabled' WHERE id = $1", [
      user.id,
    ]);

    expect((await rotate(token, newHash())).outcome).toBe('invalid');
    expect(await activeSessionCount(user.id)).toBe(0);
  });

  it('supports platform-user sessions and revoke-all for the context actor only', async () => {
    const staff = await createPlatformUser();
    const token = newHash();
    await createSession({ platformUserId: staff.id }, token);
    const rotated = await rotate(token, newHash());
    expect(rotated.outcome).toBe('rotated');

    const revoked = await asApp(
      { 'app.platform_user_id': staff.id },
      async (client) => {
        const { rows } = await client.query<{ n: number }>(
          'SELECT app.auth_revoke_all_sessions(NULL, $1) AS n',
          [staff.id],
        );
        return rows[0].n;
      },
    );
    expect(revoked).toBe(1);
  });

  it('lets a user read only their own sessions', async () => {
    const user = await createUser();
    const other = await createUser();
    await createSession({ userId: user.id }, newHash());
    await createSession({ userId: other.id }, newHash());

    const visible = await asApp({ 'app.user_id': user.id }, async (client) => {
      const { rows } = await client.query<{ user_id: string }>(
        'SELECT user_id FROM sessions',
      );
      return rows;
    });
    expect(visible).toEqual([{ user_id: user.id }]);

    await expect(
      asApp({ 'app.user_id': user.id }, (client) =>
        client.query('UPDATE sessions SET revoked_at = now()'),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});
