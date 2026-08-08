# Prompt 13 — Step 0 Report

## Step 0a — Production orphan count

**Query run (read-only against production):**

```sql
SELECT COUNT(*) AS orphans
FROM fixture_players fp
WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = fp.player_id);
```

**Result:**

```
orphans
8
```

Matches the prediction in Prompt 13 exactly. ✓

---

## Step 0b — Production write-path determination

**Agent write path tested:**

```sql
DELETE FROM fixture_players fp
WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = fp.player_id);
```

**Result:**

```
ERROR: cannot execute DELETE in a read-only transaction
```

The `executeSql` callback with `environment: "production"` is read-only. The agent has no write path to the production database.

---

## Action required from you

The one remaining write path I cannot test myself is the **Replit database pane / SQL console UI**.

Please open the production database pane and attempt to run exactly this statement:

```sql
DELETE FROM fixture_players fp
WHERE NOT EXISTS (SELECT 1 FROM players p WHERE p.id = fp.player_id);
```

### If the pane accepts the DELETE

- Tell me the rows-affected count.
- I will re-run the Step 0a query to confirm it returns 0.
- Then publish Prompt 12 unchanged — the FK will now succeed.
- Steps 1 and 2 are skipped entirely.

### If the pane is also read-only (rejects the DELETE)

- Tell me, and I will proceed to Step 1:
  - Remove the FK from `lib/db/src/schema/fixtures.ts`
  - Generate migration `0004_temp_drop_fixture_players_fk`
  - Apply to dev only
  - Add a one-time startup repair in `artifacts/api-server/src/index.ts`
  - Publish (carries unique indexes, column drops, FK removal, startup repair)
  - Confirm production orphan count = 0 and log line
  - Then Step 2: re-add FK, generate `0005_restore_fixture_players_fk`, publish again

---

## Scope limits (not proceeding past Step 0 until you respond)

- Will **not** attempt a publish until the orphan situation is resolved.
- Will **not** weaken the FK to `ON DELETE CASCADE`.
- Will **not** edit migrations 0002 or 0003.
- Will **not** run `drizzle-kit push` against dev or production.
- Will **not** choose "Copy development database to production" in the publish dialog.
