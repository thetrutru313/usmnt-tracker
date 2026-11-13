# Recorded data migrations

Add one file using the next number, then add its migration to `DATA_MIGRATIONS`
in strictly ascending, unique ID order. Each migration receives a transaction.
Use guarded, idempotent SQL (`WHERE NOT EXISTS`, `IS DISTINCT FROM`) and pass
date-only values as strings, not JavaScript `Date` objects.

Never edit, renumber, or delete a migration once it is on main. Add a new
migration to correct a previous change. Do not convert historical hand-run SQL.

Never use a migration to change senior sentinel fixture fields:
`SENIOR_SENTINEL_FIXTURES` is re-applied on every boot and would undo that change.
Edit the canonical fixture list instead.

This runner changes **data only**, never schema. Publish creates the schema
table. Each migration and its ledger row commit together under a fixed
transaction-level advisory lock. A failure rolls back that migration and stops
later migrations, but the server still starts. Inspect
`server_config['dataMigrations.lastBoot']` for the boot result; job health
exposes only its timestamp and IDs, not error text.
