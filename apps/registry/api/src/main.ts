import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { initCryptoWasm } from '@syr-is/crypto';
import { AppModule } from './app.module';

async function bootstrap() {
	// Crypto WASM must be initialized before any signature verification
	await initCryptoWasm();

	const app = await NestFactory.create(AppModule);

	app.setGlobalPrefix('api/v1');
	app.enableCors();

	const config = new DocumentBuilder()
		.setTitle('SYR Registry API')
		.setDescription(
			'REST-only, signature-verified hosting record directory for did:syr identities.'
		)
		.setVersion('1.0')
		.addTag('registry')
		.build();

	const document = SwaggerModule.createDocument(app, config, {
		ignoreGlobalPrefix: false
	});
	const cleanedDoc = cleanupOpenApiDoc(document);

	app.use(
		'/reference',
		apiReference({
			theme: 'purple',
			content: cleanedDoc
		})
	);

	const port = process.env.REGISTRY_PORT || 3100;
	await app.listen(port);
	console.log(`🔑 SYR Registry API listening on port ${port}`);
	console.log(`📖 API docs: http://localhost:${port}/reference`);
}
bootstrap();
