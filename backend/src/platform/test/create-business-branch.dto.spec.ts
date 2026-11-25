import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBusinessBranchDto } from '../dto/create-business-branch.dto';

describe('CreateBusinessBranchDto', () => {
  it('accepts branch details without terminal names', async () => {
    const dto = plainToInstance(CreateBusinessBranchDto, {
      name: 'Main Branch',
      code: 'MAIN',
      address: 'Main Street',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('accepts one or more named terminals', async () => {
    const dto = plainToInstance(CreateBusinessBranchDto, {
      name: 'Main Branch',
      code: 'MAIN',
      terminals: [{ name: 'Counter One' }, { name: 'Counter Two' }],
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects an empty terminal list and blank terminal names', async () => {
    const empty = plainToInstance(CreateBusinessBranchDto, {
      name: 'Main Branch',
      code: 'MAIN',
      terminals: [],
    });
    const blankName = plainToInstance(CreateBusinessBranchDto, {
      name: 'Main Branch',
      code: 'MAIN',
      terminals: [{ name: '   ' }],
    });
    expect(await validate(empty)).not.toHaveLength(0);
    expect(await validate(blankName)).not.toHaveLength(0);
  });
});
