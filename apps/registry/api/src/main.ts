import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

	app.enableCors();

	const port = process.env.REGISTRY_PORT || 3100;
	await app.listen(port);
	console.log(`🔑 SYR Registry API listening on port ${port}`);
}
bootstrap();
