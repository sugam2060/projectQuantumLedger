import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'node:net';
import { DatabaseService } from './database/database.service';
import { RedisService } from './redis/redis.service';

type CheckStatus = 'ready' | 'not_ready';

export interface ReadinessResult {
  isReady: boolean;
  body: {
    status: 'ready' | 'not_ready';
    checks: {
      postgresql: CheckStatus;
      rabbitmq: CheckStatus;
      redis: CheckStatus;
    };
  };
}

@Injectable()
export class AppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  getHello() {
    return 'Hello World!';
  }

  async getReadiness(): Promise<ReadinessResult> {
    const [postgresql, rabbitmq, redis] = await Promise.all([
      this.checkPostgres(),
      this.checkUrl(this.configService.getOrThrow<string>('RABBITMQ_URL')),
      this.checkRedis(),
    ]);

    const checks = {
      postgresql: this.toStatus(postgresql),
      rabbitmq: this.toStatus(rabbitmq),
      redis: this.toStatus(redis),
    };

    const isReady = Object.values(checks).every(
      (status) => status === 'ready',
    );

    return {
      isReady,
      body: {
        status: isReady ? 'ready' : 'not_ready',
        checks,
      },
    };
  }

  private async checkPostgres(): Promise<boolean> {
    try {
      await this.database.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  private checkUrl(url: string): Promise<boolean> {
    const endpoint = new URL(url);
    const defaultPorts: Record<string, number> = {
      amqp: 5672,
      amqps: 5671,
    };
    const port = endpoint.port
      ? Number(endpoint.port)
      : defaultPorts[endpoint.protocol.replace(':', '')];

    if (!port) return Promise.resolve(false);
    return this.checkTcp(endpoint.hostname, port);
  }

  private checkTcp(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new Socket();
      let settled = false;

      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(ready);
      };

      socket.setTimeout(1000);
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
      socket.connect(port, host);
    });
  }

  private toStatus(ready: boolean): CheckStatus {
    return ready ? 'ready' : 'not_ready';
  }
}
