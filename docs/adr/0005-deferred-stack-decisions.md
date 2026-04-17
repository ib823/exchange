# ADR-0005 — Deferred stack decisions (Effect-TS, Temporal, Drizzle, Biome, Zod 4)

**Status:** Not adopted in Phase 1 (M3.0, 2026-04-17)
**Deciders:** Platform engineering
**Supersedes:** None

## Context

During M3.0 stack review several "should we?" questions surfaced for
libraries that are currently popular or technically interesting. Rather
than relitigate them each time, record the decision here so future
contributors see both the answer and the trigger for revisiting.

## Decision

### Effect-TS

Do not adopt in Phase 1. Steep learning curve; the codebase currently has
one primary contributor. The explicit error + dependency modelling Effect
provides is attractive, but the cost of framework adoption outweighs the
benefit at our current orchestration complexity.

**Re-evaluate:** M5+ if orchestration complexity emerges (multi-hop
submission flows, saga-style rollbacks, fan-out retries).

### Temporal

Do not adopt in Phase 1. BullMQ is sufficient for the current M3/M4
workflow patterns: enqueue, retry with exponential backoff, dead-letter,
delayed execution. Temporal's operational weight (a separate Temporal
cluster, a distinct SDK surface) is not justified by our current patterns.

**Re-evaluate:** M5 Partner Packs, specifically when hours-long
acknowledgement-poll workflows appear (some bank H2H profiles may require
this). If at that point the retry logic has grown complex enough to resemble
saga orchestration, Temporal earns another look.

### Drizzle ORM

Permanent rejection for Phase 1. We have 18 Prisma models and a migration
history. The switching cost exceeds Drizzle's benefits for a codebase at
this scale.

**Re-evaluate:** Not in this project. A future greenfield project might
start with Drizzle; this one stays on Prisma.

### Biome

Do not adopt in Phase 1. Biome's linting is fast and ergonomic, but our
ESLint configuration includes custom security rules (type-aware
`@typescript-eslint` rules plus project-specific bans) that do not yet
have Biome equivalents. Switching would regress our security posture.

**Re-evaluate:** M6, when Biome's rule parity is closer and when we have
capacity to port our custom rules.

### Zod 4.x

Do not adopt in M3.0. Zod 4 has breaking changes
([`.strict()`](https://zod.dev/) semantics on objects,
`z.string().datetime()` return-type shift, deprecated method removals).
§15 gotcha 3 estimated 2–3 hours of migration across this codebase's
schema count. Zod 3.25.76 is the current floor adopted in §5.

**Re-evaluate:** After Zod 3.25.x has been in production for one full
milestone and the team has bandwidth for the 4.x migration.

## Consequences

**Positive:**

- Future conversations start from "why not X" with the answer already in
  hand.
- Trigger conditions are specific; this is not a blanket "no, forever"
  for most of these.

**Negative:**

- We may end up doing the Zod 4 migration anyway when `nestjs-zod` or
  another key dep drops 3.x support; document the state of that
  compatibility at each milestone.
- Biome's developer ergonomics may drag behind competing projects; the M6
  re-evaluation is firm.

## References

- `_plan/M3_0_FOUNDATION_RESET.md` §6.3, §13, §15 gotcha 3
