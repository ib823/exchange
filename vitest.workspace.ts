import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/common/vitest.config.ts',
  'packages/schemas/vitest.config.ts',
  'packages/crypto/vitest.config.ts',
  'packages/observability/vitest.config.ts',
  'packages/partner-profiles/vitest.config.ts',
  'packages/db/vitest.config.ts',
  'apps/control-plane/vitest.config.ts',
  'apps/data-plane/vitest.config.ts',
]);
