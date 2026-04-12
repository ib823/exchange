import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getConfig } from '@sep/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

const cfg = getConfig();

@Module({
  imports: [JwtModule.register({
    secret: cfg.auth.jwtSecret,
    signOptions: { expiresIn: cfg.auth.jwtExpiry, issuer: cfg.auth.jwtIssuer },
  })],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
