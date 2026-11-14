import { jest as jestGlobal } from '@jest/globals';
const jest = jestGlobal as unknown as typeof globalThis.jest;
import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from './redis.service';
import { REDIS_CLIENT } from './redis.config';
import Redis from 'ioredis';

// Mock the Redis client
const mockRedisClient = {
  quit: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  zadd: jest.fn(),
  zcount: jest.fn(),
  zremrangebyscore: jest.fn(),
  expire: jest.fn(),
  eval: jest.fn(),
  pipeline: jest.fn(),
  setnx: jest.fn(),
  pexpire: jest.fn(),
  hset: jest.fn(),
  hget: jest.fn(),
  hincrby: jest.fn(),
  hdel: jest.fn(),
  hexists: jest.fn(),
  keys: jest.fn(),
  scan: jest.fn(),
  ttl: jest.fn(),
  pttl: jest.fn(),
  incr: jest.fn(),
  incrby: jest.fn(),
  mget: jest.fn(),
  mset: jest.fn(),
};

describe('RedisService', () => {
  let service: RedisService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: REDIS_CLIENT,
          useValue: mockRedisClient,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);

    // Clear all mocks before each test
    Object.values(mockRedisClient).forEach((mock) => {
      if (typeof mock === 'function') {
        mock.mockClear();
      }
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleDestroy', () => {
    it('should call redis.quit()', async () => {
      mockRedisClient.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('should call redis.set with ttl when provided', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.set('test-key', 'test-value', 3600);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
        'EX',
        3600,
      );
    });

    it('should call redis.set without ttl when not provided', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.set('test-key', 'test-value');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
      );
    });
  });

  describe('get', () => {
    it('should call redis.get and return the value', async () => {
      mockRedisClient.get.mockResolvedValue('test-value');

      const result = await service.get('test-key');

      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.get('non-existent-key');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should call redis.del and return the number of deleted keys', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      const result = await service.delete('test-key');

      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
      expect(result).toBe(1);
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockRedisClient.exists.mockResolvedValue(1);

      const result = await service.exists('test-key');

      expect(mockRedisClient.exists).toHaveBeenCalledWith('test-key');
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);

      const result = await service.exists('non-existent-key');

      expect(result).toBe(false);
    });
  });

  describe('zadd', () => {
    it('should call redis.zadd and return the number of added elements', async () => {
      mockRedisClient.zadd.mockResolvedValue(1);

      const result = await service.zadd('sorted-set-key', 100, 'member1');

      expect(mockRedisClient.zadd).toHaveBeenCalledWith(
        'sorted-set-key',
        100,
        'member1',
      );
      expect(result).toBe(1);
    });
  });

  describe('zcount', () => {
    it('should call redis.zcount and return the count', async () => {
      mockRedisClient.zcount.mockResolvedValue(5);

      const result = await service.zcount('sorted-set-key', 0, 100);

      expect(mockRedisClient.zcount).toHaveBeenCalledWith(
        'sorted-set-key',
        0,
        100,
      );
      expect(result).toBe(5);
    });
  });

  describe('zremrangebyscore', () => {
    it('should call redis.zremrangebyscore and return the number of removed elements', async () => {
      mockRedisClient.zremrangebyscore.mockResolvedValue(3);

      const result = await service.zremrangebyscore('sorted-set-key', 0, 100);

      expect(mockRedisClient.zremrangebyscore).toHaveBeenCalledWith(
        'sorted-set-key',
        0,
        100,
      );
      expect(result).toBe(3);
    });
  });

  describe('expire', () => {
    it('should call redis.expire and return true when successful', async () => {
      mockRedisClient.expire.mockResolvedValue(1);

      const result = await service.expire('test-key', 3600);

      expect(mockRedisClient.expire).toHaveBeenCalledWith('test-key', 3600);
      expect(result).toBe(true);
    });

    it('should call redis.expire and return false when unsuccessful', async () => {
      mockRedisClient.expire.mockResolvedValue(0);

      const result = await service.expire('test-key', 3600);

      expect(result).toBe(false);
    });
  });

  describe('eval', () => {
    it('should call redis.eval and return the result', async () => {
      const script = 'return redis.call("GET", KEYS[1])';
      mockRedisClient.eval.mockResolvedValue('script-result');

      const result = await service.eval(script, 1, 'key1', 'arg1');

      expect(mockRedisClient.eval).toHaveBeenCalledWith(
        script,
        1,
        'key1',
        'arg1',
      );
      expect(result).toBe('script-result');
    });
  });

  describe('pipeline', () => {
    it('should call redis.pipeline and return the pipeline instance', async () => {
      const mockPipeline = { exec: jest.fn() };
      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      const result = await service.pipeline();

      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(result).toBe(mockPipeline);
    });
  });

  describe('setnx', () => {
    it('should call redis.set with NX option and return true when successful', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRedisClient.expire.mockResolvedValue(1);

      const result = await service.setnx('test-key', 'test-value', 3600);

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
        'NX',
      );
      expect(mockRedisClient.expire).toHaveBeenCalledWith('test-key', 3600);
      expect(result).toBe(true);
    });

    describe('setIfAbsent', () => {
      it('sets a value and expiry atomically only when the key is absent', async () => {
        mockRedisClient.set.mockResolvedValue('OK');

        await expect(
          service.setIfAbsent('mail:sent:job-1', 'sent', 86400),
        ).resolves.toBe(true);

        expect(mockRedisClient.set).toHaveBeenCalledWith(
          'mail:sent:job-1',
          'sent',
          'EX',
          86400,
          'NX',
        );
      });
    });

    describe('compareAndDelete', () => {
      it('deletes a key only when its current value matches', async () => {
        mockRedisClient.eval.mockResolvedValue(1);

        await expect(
          service.compareAndDelete('mail:lock:job-1', 'token'),
        ).resolves.toBe(true);

        expect(mockRedisClient.eval).toHaveBeenCalledWith(
          expect.stringContaining("redis.call('GET'"),
          1,
          'mail:lock:job-1',
          'token',
        );
      });
    });

    it('should call redis.set with NX option and return false when unsuccessful', async () => {
      mockRedisClient.set.mockResolvedValue(null);

      const result = await service.setnx('test-key', 'test-value');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
        'NX',
      );
      expect(result).toBe(false);
    });
  });

  describe('pexpire', () => {
    it('should call redis.pexpire and return true when successful', async () => {
      mockRedisClient.pexpire.mockResolvedValue(1);

      const result = await service.pexpire('test-key', 3600000);

      expect(mockRedisClient.pexpire).toHaveBeenCalledWith('test-key', 3600000);
      expect(result).toBe(true);
    });

    it('should call redis.pexpire and return false when unsuccessful', async () => {
      mockRedisClient.pexpire.mockResolvedValue(0);

      const result = await service.pexpire('test-key', 3600000);

      expect(result).toBe(false);
    });
  });

  describe('hset', () => {
    it('should call redis.hset and return the result', async () => {
      mockRedisClient.hset.mockResolvedValue(1);

      const result = await service.hset('hash-key', 'field1', 'value1');

      expect(mockRedisClient.hset).toHaveBeenCalledWith(
        'hash-key',
        'field1',
        'value1',
      );
      expect(result).toBe(1);
    });
  });

  describe('hget', () => {
    it('should call redis.hget and return the value', async () => {
      mockRedisClient.hget.mockResolvedValue('field-value');

      const result = await service.hget('hash-key', 'field1');

      expect(mockRedisClient.hget).toHaveBeenCalledWith('hash-key', 'field1');
      expect(result).toBe('field-value');
    });

    it('should return null when field does not exist', async () => {
      mockRedisClient.hget.mockResolvedValue(null);

      const result = await service.hget('hash-key', 'non-existent-field');

      expect(result).toBeNull();
    });
  });

  describe('hincrby', () => {
    it('should call redis.hincrby and return the result', async () => {
      mockRedisClient.hincrby.mockResolvedValue(5);

      const result = await service.hincrby('hash-key', 'counter', 1);

      expect(mockRedisClient.hincrby).toHaveBeenCalledWith(
        'hash-key',
        'counter',
        1,
      );
      expect(result).toBe(5);
    });
  });

  describe('hdel', () => {
    it('should call redis.hdel and return the number of deleted fields', async () => {
      mockRedisClient.hdel.mockResolvedValue(2);

      const result = await service.hdel('hash-key', 'field1', 'field2');

      expect(mockRedisClient.hdel).toHaveBeenCalledWith(
        'hash-key',
        'field1',
        'field2',
      );
      expect(result).toBe(2);
    });
  });

  describe('hexists', () => {
    it('should call redis.hexists and return true when field exists', async () => {
      mockRedisClient.hexists.mockResolvedValue(1);

      const result = await service.hexists('hash-key', 'field1');

      expect(mockRedisClient.hexists).toHaveBeenCalledWith(
        'hash-key',
        'field1',
      );
      expect(result).toBe(true);
    });

    it('should call redis.hexists and return false when field does not exist', async () => {
      mockRedisClient.hexists.mockResolvedValue(0);

      const result = await service.hexists('hash-key', 'non-existent-field');

      expect(result).toBe(false);
    });
  });

  describe('getSlidingWindowCount', () => {
    it('should calculate minScore and call redis.zcount', async () => {
      mockRedisClient.zcount.mockResolvedValue(10);

      const result = await service.getSlidingWindowCount(
        'rate-limit-key',
        60000,
        100000,
      );

      expect(mockRedisClient.zcount).toHaveBeenCalledWith(
        'rate-limit-key',
        40000,
        100000,
      );
      expect(result).toBe(10);
    });
  });

  describe('addToSlidingWindow', () => {
    it('should create a pipeline with zadd and expire commands', async () => {
      const mockPipeline = {
        zadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          ['OK', 1],
          ['OK', 1],
        ]),
      };

      mockRedisClient.pipeline.mockReturnValue(mockPipeline);

      await service.addToSlidingWindow(
        'rate-limit-key',
        100000,
        'member1',
        3600,
      );

      expect(mockRedisClient.pipeline).toHaveBeenCalled();
      expect(mockPipeline.zadd).toHaveBeenCalledWith(
        'rate-limit-key',
        100000,
        'member1',
      );
      expect(mockPipeline.expire).toHaveBeenCalledWith('rate-limit-key', 3600);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });

  describe('cleanSlidingWindow', () => {
    it('should calculate minScore and call redis.zremrangebyscore', async () => {
      mockRedisClient.zremrangebyscore.mockResolvedValue(5);

      const result = await service.cleanSlidingWindow(
        'rate-limit-key',
        60000,
        100000,
      );

      expect(mockRedisClient.zremrangebyscore).toHaveBeenCalledWith(
        'rate-limit-key',
        '-inf',
        40000,
      );
      expect(result).toBe(5);
    });
  });

  describe('keys', () => {
    it('should call redis.keys and return the keys', async () => {
      mockRedisClient.keys.mockResolvedValue(['key1', 'key2', 'key3']);

      const result = await service.keys('pattern*');

      expect(mockRedisClient.keys).toHaveBeenCalledWith('pattern*');
      expect(result).toEqual(['key1', 'key2', 'key3']);
    });
  });

  describe('scan', () => {
    it('should call redis.scan and return cursor and keys', async () => {
      mockRedisClient.scan.mockResolvedValue(['10', ['key1', 'key2']]);

      const result = await service.scan(0, 'pattern*', 50);

      expect(mockRedisClient.scan).toHaveBeenCalledWith(
        0,
        'MATCH',
        'pattern*',
        'COUNT',
        50,
      );
      expect(result).toEqual([10, ['key1', 'key2']]);
    });
  });

  describe('ttl', () => {
    it('should call redis.ttl and return the TTL', async () => {
      mockRedisClient.ttl.mockResolvedValue(3600);

      const result = await service.ttl('test-key');

      expect(mockRedisClient.ttl).toHaveBeenCalledWith('test-key');
      expect(result).toBe(3600);
    });
  });

  describe('pttl', () => {
    it('should call redis.pttl and return the TTL in milliseconds', async () => {
      mockRedisClient.pttl.mockResolvedValue(3600000);

      const result = await service.pttl('test-key');

      expect(mockRedisClient.pttl).toHaveBeenCalledWith('test-key');
      expect(result).toBe(3600000);
    });
  });

  describe('incr', () => {
    it('should call redis.incr and return the incremented value', async () => {
      mockRedisClient.incr.mockResolvedValue(5);

      const result = await service.incr('counter');

      expect(mockRedisClient.incr).toHaveBeenCalledWith('counter');
      expect(result).toBe(5);
    });
  });

  describe('incrby', () => {
    it('should call redis.incrby and return the incremented value', async () => {
      mockRedisClient.incrby.mockResolvedValue(15);

      const result = await service.incrby('counter', 10);

      expect(mockRedisClient.incrby).toHaveBeenCalledWith('counter', 10);
      expect(result).toBe(15);
    });
  });

  describe('mget', () => {
    it('should call redis.mget and return the values', async () => {
      mockRedisClient.mget.mockResolvedValue(['value1', null, 'value3']);

      const result = await service.mget('key1', 'key2', 'key3');

      expect(mockRedisClient.mget).toHaveBeenCalledWith('key1', 'key2', 'key3');
      expect(result).toEqual(['value1', null, 'value3']);
    });
  });

  describe('mset', () => {
    it('should call redis.mset with flattened key-value pairs', async () => {
      mockRedisClient.mset.mockResolvedValue('OK');

      const keyValuePairs = { key1: 'value1', key2: 'value2', key3: 'value3' };
      const result = await service.mset(keyValuePairs);

      expect(mockRedisClient.mset).toHaveBeenCalledWith(
        'key1',
        'value1',
        'key2',
        'value2',
        'key3',
        'value3',
      );
      expect(result).toBe('OK');
    });
  });
});
