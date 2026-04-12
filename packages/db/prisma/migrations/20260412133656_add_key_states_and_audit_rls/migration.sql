-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'KEY_REFERENCE_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE 'KEY_REFERENCE_REINSTATED';
ALTER TYPE "AuditAction" ADD VALUE 'KEY_REFERENCE_COMPROMISED';
ALTER TYPE "AuditAction" ADD VALUE 'KEY_REFERENCE_DESTROYED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KeyState" ADD VALUE 'SUSPENDED';
ALTER TYPE "KeyState" ADD VALUE 'COMPROMISED';
ALTER TYPE "KeyState" ADD VALUE 'DESTROYED';
