# ADR-0003 — Direct `@nestjs/jwt` guard, no Passport

**Status:** Accepted (M3.0, 2026-04-17)
**Deciders:** Platform engineering, security engineering
**Supersedes:** None

## Context

`passport` (0.7.0) and `passport-jwt` (4.0.1) were installed but never
imported by runtime code. The forensic audit flagged them as R5-006
(single-maintainer risk). `@nestjs/passport` was installed as a wrapper
but also not used — a `JwtAuthGuard` using `@nestjs/jwt` directly was
already in place.

Strategic signal: Phase 1 has exactly two auth strategies (JWT + API key),
both service-managed. There is no plan for OAuth, SAML, OIDC, or similar
federation in Phase 1 or Phase 2 roadmap. Passport's strategy-swap
abstraction solves a problem this platform does not have.

## Decision

Remove passport, passport-jwt, `@nestjs/passport`, and their `@types/*`
packages. Use a ~80-line `JwtAuthGuard` that calls `JwtService.verifyAsync`
directly with algorithm pinned to HS256:

```ts
const payload = await this.jwt.verifyAsync(token, {
  secret: cfg.auth.jwtSecret,
  issuer: cfg.auth.jwtIssuer,
  algorithms: ['HS256'],
});
```

Guard is registered as `APP_GUARD` with explicit ordering:
`ThrottlerGuard → JwtAuthGuard → TenantGuard → RolesGuard`. A
`@Public()` decorator opts specific routes out.

## Consequences

**Positive:**

- Three fewer transitive packages in the security-critical path.
- Algorithm pinning is explicit at the callsite, not buried in a strategy
  config.
- Smaller surface area for supply-chain attacks (R5-006).
- Closes single-maintainer-risk finding.

**Negative:**

- If OAuth / SAML / OIDC is ever required, the `JwtAuthGuard` interface is
  small enough to replace, but the swap will not be cost-free.
- Multi-strategy auth (e.g., accept _either_ JWT _or_ API key on one
  endpoint) requires guard-level orchestration rather than Passport's
  `AuthGuard(['jwt', 'api-key'])` sugar. API-key validation currently lives
  in `AuthService.validateApiKey`, invoked from a separate path.

**Not changed in M3.0:**

- Refresh-token rotation, MFA enrolment/enforcement, lockout — these are M3
  (R3-002, R3-004).

## Related findings

Closes: R5-006 (fully).

## References

- `_plan/M3_0_FOUNDATION_RESET.md` §7C
- `apps/control-plane/src/common/guards/jwt-auth.guard.ts`
