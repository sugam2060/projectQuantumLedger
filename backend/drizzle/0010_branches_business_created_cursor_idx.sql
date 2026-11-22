CREATE INDEX IF NOT EXISTS "branches_business_created_id_idx"
  ON "branches" USING btree ("business_id", "created_at", "id");
