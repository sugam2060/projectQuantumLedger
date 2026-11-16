import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { DatabaseService } from '../../database/database.service';
import { RabbitMQService } from '../../utils/rabbitmq.service';
import { MailOutboxPublisher } from '../mail-outbox.publisher';

describe('MailOutboxPublisher', () => {
  const database = { transactionWithSession: jest.fn() };
  const rabbit = {
    isConnected: true,
    publish: jest.fn(),
    onConnected: jest.fn(() => jest.fn()),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'MAIL_EXCHANGE_NAME' ? 'mail.events' : 'mail.send',
    ),
  };
  let publisher: MailOutboxPublisher;

  function setup(rows: object[]) {
    const selectQuery = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      for: jest.fn().mockResolvedValue(rows),
    };
    const updateValues: unknown[] = [];
    const tx = {
      select: jest.fn().mockReturnValue(selectQuery),
      update: jest.fn(() => ({
        set: (values: unknown) => {
          updateValues.push(values);
          return { where: jest.fn().mockResolvedValue([]) };
        },
      })),
    };
    database.transactionWithSession.mockImplementation(
      async (_session: unknown, callback: (transaction: unknown) => unknown) =>
        callback(tx),
    );
    return { updateValues };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    rabbit.isConnected = true;
    publisher = new MailOutboxPublisher(
      database as unknown as DatabaseService,
      rabbit as unknown as RabbitMQService,
      config as never,
    );
  });

  it('publishes claimed outbox jobs and marks them sent', async () => {
    const payload = {
      id: 'mail-job-id',
      to: 'owner@example.com',
      subject: 'Owner activation',
      template: 'redeem-code' as const,
      context: { redeemCode: 'CODE', expiresAt: '2026-11-16T00:00:00.000Z' },
      createdAt: '2026-11-15T00:00:00.000Z',
    };
    const { updateValues } = setup([
      {
        id: 'outbox-id',
        payload,
        attempts: 0,
        status: 'pending',
        availableAt: new Date(Date.now() - 1000),
      },
    ]);
    rabbit.publish.mockResolvedValue(true);

    await publisher.dispatch();

    expect(rabbit.publish).toHaveBeenCalledWith(
      'mail.events',
      'mail.send',
      payload,
      { messageId: 'mail-job-id' },
    );
    expect(updateValues).toHaveLength(2);
    expect(updateValues[0]).toMatchObject({
      status: 'processing',
      attempts: 1,
    });
    expect(updateValues[1]).toMatchObject({ status: 'sent' });
  });

  it('releases a job for retry when RabbitMQ publish fails', async () => {
    const { updateValues } = setup([
      {
        id: 'outbox-id',
        payload: {
          id: 'mail-job-id',
          to: 'owner@example.com',
          subject: 'Owner activation',
          template: 'redeem-code',
          context: {
            redeemCode: 'CODE',
            expiresAt: '2026-11-16T00:00:00.000Z',
          },
          createdAt: '2026-11-15T00:00:00.000Z',
        },
        attempts: 0,
        status: 'pending',
        availableAt: new Date(Date.now() - 1000),
      },
    ]);
    rabbit.publish.mockRejectedValue(new Error('broker unavailable'));

    await publisher.dispatch();

    expect(updateValues).toHaveLength(2);
    expect(updateValues[1]).toMatchObject({
      status: 'pending',
      lockedUntil: null,
      lastError: 'broker unavailable',
    });
    expect(updateValues[1]).toHaveProperty('availableAt');
  });

  it('does not query the database while RabbitMQ is disconnected', async () => {
    rabbit.isConnected = false;

    await publisher.dispatch();

    expect(database.transactionWithSession).not.toHaveBeenCalled();
  });
});
