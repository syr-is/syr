import { createZodDto } from 'nestjs-zod';
import { DeleteRecordSchema } from '@syr-is/types';

export class DeleteRecordDto extends createZodDto(DeleteRecordSchema) {}
