import { createZodDto } from 'nestjs-zod';
import { DirectoryUpsertSchema } from '@syr-is/types';

export class DirectoryUpsertDto extends createZodDto(DirectoryUpsertSchema) {}
