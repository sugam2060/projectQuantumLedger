import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAIL_TEMPLATE_FILES, type MailTemplateName } from './mail.constants';

export interface MailJob {
  id: string;
  to: string | string[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  template: MailTemplateName;
  context: Record<string, unknown>;
  text?: string;
  attachments?: MailAttachment[];
  priority?: number;
  correlationId?: string;
  createdAt: string;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
  cid?: string;
}

export class MailAttachmentPayload implements MailAttachment {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\\/:*?"<>|\r\n]+$/)
  filename!: string;

  @IsString()
  @Matches(/^[\w.+-]+\/[\w.+-]+$/)
  contentType!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  contentBase64!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[\w.-]+@[\w.-]+$/)
  cid?: string;
}

export class MailJobPayload implements MailJob {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
  id!: string;

  @IsEmail({}, { each: true })
  to!: string | string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  @Matches(/^[^\r\n]+$/)
  from?: string;

  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @IsOptional()
  @IsEmail({}, { each: true })
  cc?: string | string[];

  @IsOptional()
  @IsEmail({}, { each: true })
  bcc?: string | string[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(998)
  @Matches(/^[^\r\n]+$/)
  subject!: string;

  @IsString()
  @IsIn(Object.keys(MAIL_TEMPLATE_FILES))
  template!: MailTemplateName;

  @IsObject()
  context!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MailAttachmentPayload)
  attachments?: MailAttachmentPayload[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[^\r\n]+$/)
  correlationId?: string;

  @IsDateString()
  createdAt!: string;
}

export class PermanentMailError extends Error {
  readonly permanent = true;

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'PermanentMailError';
  }
}

export class RetryableMailError extends Error {
  readonly permanent = false;

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RetryableMailError';
  }
}
