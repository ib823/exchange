import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getConfig } from '@sep/common';
import { createLogger, setLogLevel } from '@sep/observability';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const cfg = getConfig();
  setLogLevel(cfg.app.logLevel);
  const logger = createLogger({ service: 'data-plane', module: 'bootstrap' });

  await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });

  logger.info({ env: cfg.app.appEnv }, 'Data plane worker started — listening to queues');
}

void bootstrap();
