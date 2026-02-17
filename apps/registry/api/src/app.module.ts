import { Module, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DbService } from './db/db.service';
import { RegistryController } from './registry/registry.controller';
import { RegistryService } from './registry/registry.service';

@Module({
	providers: [DbService, RegistryService],
	controllers: [RegistryController]
})
export class AppModule implements OnModuleInit, OnModuleDestroy {
	constructor(private readonly db: DbService) {}

	async onModuleInit() {
		await this.db.connect();
		await this.db.initializeSchema();
	}

	async onModuleDestroy() {
		await this.db.disconnect();
	}
}
