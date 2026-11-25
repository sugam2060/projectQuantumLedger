import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBusinessDto } from '../dto/update-business.dto';

describe('UpdateBusinessDto', () => {
  it('accepts a valid partial profile update and trims string values', async () => {
    const dto = plainToInstance(UpdateBusinessDto, {
      reason: ' Approved operation ',
      displayName: ' New shop ',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.reason).toBe('Approved operation');
    expect(dto.displayName).toBe('New shop');
  });

  it('requires a reason and validates contact email', async () => {
    const errors = await validate(
      plainToInstance(UpdateBusinessDto, { primaryContactEmail: 'bad' }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['reason', 'primaryContactEmail']),
    );
  });
});
