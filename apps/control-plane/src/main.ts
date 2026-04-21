import 'reflect-metadata';
import Redis from 'ioredis';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodValidationPipe, cleanupOpenApiDoc } from 'nestjs-zod';
import { getConfig } from '@sep/common';
import { createLogger, setLogLevel } from '@sep/observability';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { registerEdgeRateLimit } from './bootstrap/edge-rate-limit';

/**
 * DoS-defence knobs applied before Nest takes over routing. These
 * are Fastify-level and protect against the traffic shapes that
 * would otherwise get past our app-level guards (slow-loris,
 * oversized bodies, etc.). Tunable via env; defaults favour safety.
 */
const BODY_LIMIT_BYTES = 2 * 1024 * 1024; // 2 MiB — covers JSON payloads; submission uploads go via separate endpoint
const CONNECTION_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Edge rate-limit thresholds (M3.A7-T01). Per-IP. Default catches
 * general abuse; /auth/* gets a tighter cap because login + MFA
 * flows are high-value and the controller-layer throttler (T02)
 * narrows further per (IP, email) / per-challenge.
 */
const EDGE_DEFAULT_MAX = 200; // requests per window
const EDGE_AUTH_MAX = 20;
const EDGE_WINDOW_MS = 60_000;

async function bootstrap(): Promise<void> {
  const cfg = getConfig();
  setLogLevel(cfg.app.logLevel);

  const logger = createLogger(
    { service: 'control-plane', module: 'bootstrap' },
    cfg.app.appEnv === 'local' || cfg.app.nodeEnv === 'development',
  );

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // Pino handles logging, not Fastify's built-in
      bodyLimit: BODY_LIMIT_BYTES,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
    }),
    { bufferLogs: true },
  );

  // ── Edge rate limiting (M3.A7-T01) ────────────────────────────────────────
  // Register BEFORE helmet so a flooded IP doesn't consume helmet's
  // CSP machinery per request. Redis-backed so multiple control-plane
  // instances share state (D-M3-11).
  //
  // trustProxy: FastifyAdapter defaults to trustProxy=false, meaning
  // per-IP limits key on the direct connection IP. Correct in dev (no
  // proxy) but will key everyone on the LB's IP once deployed behind a
  // load balancer. Production topology must be resolved before prod
  // launch — tracked as issue #42.
  const edgeRateLimitRedis = new Redis(cfg.redis.url, {
    // Separate connection from auth/MFA Redis usage; same instance,
    // different socket. See `bootstrap/edge-rate-limit.ts` header.
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });
  await registerEdgeRateLimit(app, {
    redis: edgeRateLimitRedis,
    defaultMax: EDGE_DEFAULT_MAX,
    authMax: EDGE_AUTH_MAX,
    windowMs: EDGE_WINDOW_MS,
    logger,
    apiPrefix: cfg.controlPlane.apiPrefix,
  });

  // Graceful shutdown — close Redis when the process is terminating.
  app.enableShutdownHooks();
  process.on('SIGTERM', () => {
    edgeRateLimitRedis.disconnect();
  });

  // ── Security headers ──────────────────────────────────────────────────────
  await app.register(await import('@fastify/helmet').then((m) => m.default), {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  });

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

  logger.info({ port: cfg.controlPlane.port, env: cfg.app.appEnv }, 'Control plane started');
}

void bootstrap();
