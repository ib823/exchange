# ADR-0001 — Zod-everywhere validation strategy

**Status:** Accepted (M3.0, 2026-04-17)
**Deciders:** Platform engineering
**Supersedes:** None

## Context

Phase 1 inherited two validation mechanisms side by side:

- **class-validator** (0.14.4) — the NestJS default, used nowhere in source
  but carried as a transitive peer of `@nestjs/swagger` and `@nestjs/common`.
  The forensic audit (R5-005) flagged the package itself as single-maintainer
  risk.
- **Zod** (3.x) — already the source of truth for domain schemas in
  `packages/schemas/*`. Every schema the service layer validates against
  lives there.

Controllers used a `@Body() body: unknown` + manual `parseBody(schema, body)`
helper to reconcile these two worlds. The cast is itself a finding (R4-002
boundary casts; NEW-05 approvals cast; R3-003 partner-profile transition cast).

## Decision

Use Zod as the single validation mechanism. Delete class-validator's
transitive install during §4 removals. Adopt `nestjs-zod` (5.3.0) for
`@Body()` integration:

```ts
import { createZodDto } from 'nestjs-zod';
import { CreateSubmissionSchema } from '@sep/schemas';

class CreateSubmissionDto extends createZodDto(CreateSubmissionSchema) {}

@Post()
create(@Body() dto: CreateSubmissionDto) { ... }
```

`ZodValidationPipe` is registered globally in `main.ts`. The
`HttpExceptionFilter` normalises `ZodValidationException` to the existing
`SepError(VALIDATION_SCHEMA_FAILED)` response contract so clients see no
change. nestjs-zod 5's `cleanupOpenApiDoc(doc)` replaces the deprecated
`patchNestJsSwagger()` helper for OpenAPI generation.

## Consequences

**Positive:**

- Single source of truth. Schemas live in `@sep/schemas`; controllers and
  services share the same type via `z.infer<typeof X>`.
- One fewer single-maintainer dependency (class-validator).
- Boundary casts (R4-002) eliminated on 6 of 7 body-accepting controllers.

**Negative / deferred:**

- `submissions.controller.ts` keeps the manual `parseBody` pattern because
  (a) its schema is built dynamically from config
  (`createSubmissionSchema(maxPayloadSizeBytes)`) and (b) it emits a distinct
  `VALIDATION_PAYLOAD_TOO_LARGE` error mapped to HTTP 413. nestjs-zod's
  static-DTO + single-exception-type contract doesn't fit. Flagged for M3.
- Any future endpoint that needs dynamic validation will have the same
  exception; M3 is expected to design a canonical dynamic-pipe pattern.

## Related findings

Closes: NEW-05, R3-003.
Partially closes: R4-002 (6/7 controllers).

## References

- `_plan/M3_0_FOUNDATION_RESET.md` §7A
- `_audit/findings.json` — NEW-05, R3-003, R4-002, R5-005
