import {
  Injectable,
  PipeTransform,
  UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBusinessDto } from '../dto/update-business.dto';

@Injectable()
export class UpdateBusinessValidationPipe implements PipeTransform<
  unknown,
  Promise<UpdateBusinessDto>
> {
  async transform(value: unknown): Promise<UpdateBusinessDto> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new UnprocessableEntityException(
        'A multipart form body is required',
      );
    }

    const dto = plainToInstance(UpdateBusinessDto, value);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new UnprocessableEntityException(
        'Invalid or prohibited business profile fields',
      );
    }
    return dto;
  }
}
