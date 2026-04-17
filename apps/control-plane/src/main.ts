import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { getConfig } from '@sep/common';
import { createLogger, setLogLevel } from '@sep/observability';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const cfg = getConfig();
  setLogLevel(cfg.app.logLevel);

  const logger = createLogger(
    { service: 'control-plane', module: 'bootstrap' },
    cfg.app.appEnv === 'local' || cfg.app.nodeEnv === 'development',
  );

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),   // Pino handles logging, not Fastify's built-in
    { bufferLogs: true },
  );

  // ── Security headers ──────────────────────────────────────────────────────
  await app.register(
    await import('@fastify/helmet').then((m) => m.default),
    {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
    },
  );

  // ── Global prefix and versioning ──────────────────────────────────────────
  app.setGlobalPrefix(cfg.controlPlane.apiPrefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // ── Global validation pipe (Zod via nestjs-zod) ───────────────────────────
  app.useGlobalPipes(new ZodValidationPipe());

  // ── Global exception filter ───────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── OpenAPI / Swagger (non-production only) ────────────────────────────────
  if (cfg.app.appEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Secure Exchange Platform — Control Plane API')
      .setDescription('Malaysia Secure Exchange Platform v0.1')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'ApiKey')
      .build();

    const rawDocument = SwaggerModule.createDocument(app, swaggerConfig);
    // nestjs-zod v5: post-process to inline Zod DTO schemas correctly.
    const document = cleanupOpenApiDoc(rawDocument);
    SwaggerModule.setup(`${cfg.controlPlane.apiPrefix}/docs`, app, document);

    logger.info('Swagger UI available at /%s/docs', cfg.controlPlane.apiPrefix);
  }

  // ── Start ─────────────────────────────────────────────────────────────────
  await app.listen(cfg.controlPlane.port, cfg.controlPlane.host);

  logger.info(
    { port: cfg.controlPlane.port, env: cfg.app.appEnv },
    'Control plane started',
  );
}

void bootstrap();
