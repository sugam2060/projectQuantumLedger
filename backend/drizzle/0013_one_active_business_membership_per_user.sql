DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "business_memberships"
    WHERE "is_active" = true
    GROUP BY "user_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active business membership per user'
      USING HINT = 'Resolve duplicate active business memberships before applying this migration. No membership rows were changed.';
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "business_memberships_one_active_user_uq"
  ON "business_memberships" USING btree ("user_id")
  WHERE "is_active" = true;
