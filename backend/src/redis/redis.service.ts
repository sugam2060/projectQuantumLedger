import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';

import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, 'EX', ttl);
      return;
    }

    await this.redis.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async delete(key: string): Promise<number> {
    return this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.redis.zadd(key, score, member);
  }

  async zcount(key: string, min: number, max: number): Promise<number> {
    return this.redis.zcount(key, min, max);
  }

  async zremrangebyscore(
    key: string,
    min: number,
    max: number,
  ): Promise<number> {
    return this.redis.zremrangebyscore(key, min, max);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return (await this.redis.expire(key, seconds)) === 1;
  }

  async eval<T = any>(
    script: string,
    numKeys: number,
    ...keysAndArgs: (string | number)[]
  ): Promise<T> {
    return this.redis.eval(script, numKeys, ...keysAndArgs) as Promise<T>;
  }

  async pipeline(): Promise<any> {
    return this.redis.pipeline();
  }

  // Distributed coordination methods
  async setnx(key: string, value: string, ttl?: number): Promise<boolean> {
    const result = await this.redis.set(key, value, 'NX');
    if (result === 'OK' && ttl) {
      await this.redis.expire(key, ttl);
    }
    return result === 'OK';
  }

  async pexpire(key: string, milliseconds: number): Promise<boolean> {
    return (await this.redis.pexpire(key, milliseconds)) === 1;
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    return this.redis.hset(key, field, value);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.redis.hget(key, field);
  }

  async hincrby(
    key: string,
    field: string,
    increment: number,
  ): Promise<number> {
    return this.redis.hincrby(key, field, increment);
  }

  async hdel(key: string, ...fields: string[]): Promise<number> {
    return this.redis.hdel(key, ...fields);
  }

  async hexists(key: string, field: string): Promise<boolean> {
    return (await this.redis.hexists(key, field)) === 1;
  }

  // Rate limiting specific methods
  async getSlidingWindowCount(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<number> {
    const minScore = now - windowMs;
    return this.redis.zcount(key, minScore, now);
  }

  async addToSlidingWindow(
    key: string,
    timestamp: number,
    member: string,
    ttlSeconds: number,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();
    pipeline.zadd(key, timestamp, member);
    pipeline.expire(key, ttlSeconds);
    await pipeline.exec();
  }

  async cleanSlidingWindow(
    key: string,
    windowMs: number,
    now: number,
  ): Promise<number> {
    const minScore = now - windowMs;
    return this.redis.zremrangebyscore(key, '-inf', minScore);
  }

  // Additional Redis operations for distributed coordination
  async keys(pattern: string): Promise<string[]> {
    return this.redis.keys(pattern);
  }

  async scan(
    cursor: number,
    pattern: string,
    count = 100,
  ): Promise<[number, string[]]> {
    const [nextCursor, keys] = await this.redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      count,
    );
    return [parseInt(nextCursor, 10), keys];
  }

  async del(...keys: string[]): Promise<number> {
    return this.redis.del(...keys);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async pttl(key: string): Promise<number> {
    return this.redis.pttl(key);
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async incrby(key: string, increment: number): Promise<number> {
    return this.redis.incrby(key, increment);
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return this.redis.mget(...keys);
  }

  async mset(keyValues: Record<string, string>): Promise<'OK'> {
    const args: string[] = [];
    Object.entries(keyValues).forEach(([key, value]) => {
      args.push(key, value);
    });
    return this.redis.mset(...args);
  }
}
