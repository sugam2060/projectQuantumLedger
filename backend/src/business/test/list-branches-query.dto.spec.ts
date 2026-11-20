import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListBranchesQueryDto } from '../dto/list-branches-query.dto';

describe('ListBranchesQueryDto', () => {
  it('defaults the limit and accepts timezone-aware date filters', async () => {
    const dto = plainToInstance(ListBranchesQueryDto, {
      from: '2026-10-01T00:00:00+05:45',
      to: '2026-10-29T23:59:59+05:45',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.limit).toBe(50);
  });

  it('transforms and bounds limit', async () => {
    const dto = plainToInstance(ListBranchesQueryDto, { limit: '25' });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.limit).toBe(25);

    const invalid = plainToInstance(ListBranchesQueryDto, { limit: '101' });
    expect(await validate(invalid)).not.toHaveLength(0);
  });

  it('requires time zone offsets for date range filters', async () => {
    const dto = plainToInstance(ListBranchesQueryDto, {
      from: '2026-10-01T00:00:00',
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
