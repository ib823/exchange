import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import Redis from 'ioredis';
import { getConfig } from '@sep/common';
import { VaultClient } from '@sep/crypto';
import { VAULT_CLIENT } from '../crypto-custody/crypto-custody.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LoginService } from './login.service';
import { MfaSecretVaultService } from './mfa-secret-vault.service';
import { MfaService } from './mfa.service';
import { MfaController } from './mfa.controller';
import { MfaChallengeStore, REDIS_CLIENT } from './mfa-challenge-store.service';
import { MfaVerifyService } from './mfa-verify.service';
import { MfaRecoverService } from './mfa-recover.service';
import { REFRESH_HMAC_KEY, loadRefreshHmacKey } from './refresh-hmac-key.provider';
import { RefreshTokenService } from './refresh-token.service';

const cfg = getConfig();

@Module({
  imports: [
    JwtModule.register({
      secret: cfg.auth.jwtSecret,
      signOptions: {
        expiresIn: cfg.auth.jwtExpiry as `${number}m`,
        issuer: cfg.auth.jwtIssuer,
        algorithm: 'HS256',
      },
      verifyOptions: { algorithms: ['HS256'] },
    }),
  ],
  providers: [
    AuthService,
    LoginService,
    MfaSecretVaultService,
    MfaService,
    MfaChallengeStore,
    MfaVerifyService,
    MfaRecoverService,
    RefreshTokenService,
    {
      provide: REDIS_CLIENT,
      // One Redis client per control-plane process, sharing the same
      // connection across all MFA challenge operations. Separate
      // from the data-plane BullMQ ioredis pool (different service,
      // different lifecycle). MfaChallengeStore.onModuleDestroy
      // calls quit() on shutdown.
      useFactory: (): Redis => new Redis(cfg.redis.url),
    },
    {
      // Fail-closed at boot: loadRefreshHmacKey throws SepError on
      // Vault failure, which propagates out of NestJS module init
      // and refuses to start the control-plane process.
      provide: REFRESH_HMAC_KEY,
      useFactory: (vault: VaultClient): Promise<Buffer> => loadRefreshHmacKey(vault),
      inject: [VAULT_CLIENT],
    },
  ],
  controllers: [AuthController, MfaController],
  exports: [
    AuthService,
    LoginService,
    MfaSecretVaultService,
    MfaService,
    MfaVerifyService,
    MfaRecoverService,
    RefreshTokenService,
  ],
})
export class AuthModule {}
