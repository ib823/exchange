import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '@sep/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MfaSecretVaultService } from './mfa-secret-vault.service';

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
  providers: [AuthService, MfaSecretVaultService],
  controllers: [AuthController],
  exports: [AuthService, MfaSecretVaultService],
})
export class AuthModule {}
