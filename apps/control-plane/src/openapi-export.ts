import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function exportSpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Secure Exchange Platform — Control Plane API')
    .setDescription('Malaysia Secure Exchange Platform v0.1')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'ApiKey')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  const outDir = join(__dirname, '../api');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'openapi.yaml'), JSON.stringify(document, null, 2));

  await app.close();
  // eslint-disable-next-line no-console
  console.log('OpenAPI spec written to api/openapi.yaml');
}

void exportSpec();
