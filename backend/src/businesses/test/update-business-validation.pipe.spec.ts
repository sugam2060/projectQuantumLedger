import { UnprocessableEntityException } from '@nestjs/common';
import { UpdateBusinessValidationPipe } from '../pipes/update-business-validation.pipe';

describe('UpdateBusinessValidationPipe', () => {
  const pipe = new UpdateBusinessValidationPipe();

  it('transforms and accepts permitted fields', async () => {
    await expect(
      pipe.transform({ reason: ' Update ', displayName: ' New Shop ' }),
    ).resolves.toMatchObject({ reason: 'Update', displayName: 'New Shop' });
  });

  it.each(['legalName', 'pan', 'isActive', 'createdAt', 'documents'])(
    'rejects prohibited field %s',
    async (field) => {
      await expect(
        pipe.transform({ reason: 'Update', [field]: 'not allowed' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    },
  );

  it('rejects a missing reason and invalid contact email', async () => {
    await expect(
      pipe.transform({ primaryContactEmail: 'not-an-email' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
