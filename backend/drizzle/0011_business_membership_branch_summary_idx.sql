CREATE INDEX IF NOT EXISTS "business_memberships_business_branch_active_idx"
  ON "business_memberships" USING btree ("business_id", "branch_id", "is_active");
