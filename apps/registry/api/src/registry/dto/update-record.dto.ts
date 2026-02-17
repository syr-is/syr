import { createZodDto } from 'nestjs-zod';
import { UpdateRecordSchema } from '@syr-is/types';

export class UpdateRecordDto extends createZodDto(UpdateRecordSchema) {}
