import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '@sep/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LoginService } from './login.service';
import { MfaSecretVaultService } from './mfa-secret-vault.service';
import { MfaService } from './mfa.service';
import { MfaController } from './mfa.controller';

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
  providers: [AuthService, LoginService, MfaSecretVaultService, MfaService],
  controllers: [AuthController, MfaController],
  exports: [AuthService, LoginService, MfaSecretVaultService, MfaService],
})
export class AuthModule {}
