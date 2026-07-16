#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Backfill invoice_url → invoice_urls before the schema push drops the old column.
# This is idempotent: skips backfill if invoice_url column no longer exists.
psql "$DATABASE_URL" <<'EOSQL'
ALTER TABLE transparency_months
  ADD COLUMN IF NOT EXISTS invoice_urls jsonb NOT NULL DEFAULT '[]';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transparency_months' AND column_name = 'invoice_url'
  ) THEN
    UPDATE transparency_months
    SET invoice_urls = json_build_array(
      json_build_object('label', 'Invoice', 'url', invoice_url)
    )
    WHERE invoice_url IS NOT NULL
      AND invoice_urls = '[]'::jsonb;
  END IF;
END $$;
EOSQL

# Use push-force so drizzle-kit doesn't hang on confirmation prompts in CI.
pnpm --filter db push-force
