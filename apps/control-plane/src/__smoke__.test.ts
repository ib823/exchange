// M3.0 §18 handoff check: confirm install-only deps load from this workspace.
// These imports have no runtime wiring yet — wiring happens in M3/M3.5/M4.
// The point is to catch install-shaped breakage (missing exports, binary
// build failures) before we land wiring work.
import { describe, it, expect } from 'vitest';

describe('M3.0 install smoke — @sep/control-plane', () => {
  it('imports nestjs-zod entry points (§7A)', async () => {
    const mod = await import('nestjs-zod');
    expect(typeof mod.createZodDto).toBe('function');
    expect(typeof mod.ZodValidationPipe).toBe('function');
    expect(typeof mod.cleanupOpenApiDoc).toBe('function');
  });

  it('imports @node-rs/argon2 with expected surface (§7B, ADR-0002)', async () => {
    const mod = await import('@node-rs/argon2');
    expect(typeof mod.hash).toBe('function');
    expect(typeof mod.verify).toBe('function');
    expect(mod.Algorithm).toBeDefined();
  });

  it('imports @nestjs/throttler (install-only, wired M3)', async () => {
    const mod = await import('@nestjs/throttler');
    expect(typeof mod.ThrottlerModule).toBe('function');
    expect(typeof mod.ThrottlerGuard).toBe('function');
  });

  it('imports @fastify/rate-limit (install-only, wired M3)', async () => {
    const mod = await import('@fastify/rate-limit');
    expect(mod.default).toBeDefined();
  });

  it('imports otplib (install-only, wired M3 for MFA)', async () => {
    // otplib v13 exports functional TOTP/HOTP API (no more `authenticator` namespace).
    const mod = await import('otplib');
    expect(typeof mod.generate).toBe('function');
    expect(typeof mod.verify).toBe('function');
    expect(mod.TOTP).toBeDefined();
  });

  it('imports qrcode (install-only, wired M3 for MFA enrolment)', async () => {
    const mod = await import('qrcode');
    expect(typeof mod.toDataURL).toBe('function');
  });
});
