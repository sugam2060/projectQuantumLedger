-- Snapshot resync (no schema change).
--
-- Migrations 0007-0013 were written by hand without Drizzle snapshots, and
-- meta/0004_snapshot.json contained committed merge-conflict markers, so
-- `drizzle-kit generate` could not run. This migration only records a fresh
-- snapshot (meta/0015_snapshot.json) of the current schema. The DDL that
-- drizzle-kit computed here (invitation types, terminal activation policies,
-- branch/membership indexes, one active membership per user, owner-redemption
-- policies) was already applied by 0007-0013, so nothing runs.
SELECT 1;
