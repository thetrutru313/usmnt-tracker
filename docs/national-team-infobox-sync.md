# Wikipedia national-team infobox sync verification

## Confirmed: original behavior

The old-name executable dependencies were all in
`artifacts/api-server/src/lib/nationalTeamSync.ts`:

- Team parser: `nationalteam(\d+)\s*=\s*([^\n|]+)`.
- Indexed numeric lookups: `nationalcapsN` and `nationalgoalsN`.
- Resolver US-entry predicate: `nationalteam\d+\s*=\s*[^\n|]*united states`.

Two descriptive comments also named the old parameters. No other executable
old-name dependencies were found.

The sync selected only player ID, name, and cached article title. A successfully
downloaded page with no recognized senior US entry extracted 0/0, which the sync
wrote unconditionally. Unresolved articles and failed downloads skipped writes.
The team parser also truncated piped wikilinks at their first pipe.

## Confirmed: implementation

- Accept both indexed infobox spellings and retain the entire team-value line.
  Non-indexed `national_team_update` is not a team entry.
- Preserve the existing senior/youth exclusion and article identity checks.
- Export a pure write-decision function, used by the sync.
- Decide caps and goals independently: nondecreasing parsed values are written;
  decreases keep the stored field and emit WARN with player, field, stored, and
  parsed values. Missing senior entries keep both fields, reporting parsed null.
- Log ERROR `national-team infobox format may have changed` when strictly more
  than 20% of initially capped players encounter a guard. Count each player once
  even when both fields are guarded.
- Return guard counts alongside the existing run counters. Fetching, throttling,
  retries, scheduling, and the 23-hour cooldown are unchanged.

## Confirmed: red-then-green evidence

Before implementation, the focused suite had **9 assertion failures and 5 passes**.
All 9 change-verifying cases failed on assertions, not setup/import errors:

1. New-format senior 90 caps / 33 goals, excluding indexed U15/U17 entries.
2. Resolver acceptance of the new-format US entry.
3. Missing senior entry preserves stored totals and warns.
4. Parsed 85 caps preserves stored 90 and warns.
5. Increased caps with decreased goals.
6. Increased goals with decreased caps.
7. Above-20% alarm, counting a player only once.
8. Goals-only guards count toward the alarm.
9. Full piped team text is used for youth classification.

The five already-passing regression guards covered the old spelling, uncapped
youth-only 0/0, download failure, `national_team_update`, and no alarm at exactly
20%. After implementation, **all 14 tests passed**, with no assertions weakened.
The fixtures and Wikipedia responses are mocked; these tests make no real calls.

## Confirmed: single real-Wikipedia development sync

Executed on **2026-11-02 at approximately 23:02 UTC**. Only the development
database was used. Wikipedia requests were read-only.

| Measure | Result |
| --- | ---: |
| Players checked | 78 |
| Player rows written (`playersUpdated`) | 74 |
| Players whose caps or goals actually changed | 52 |
| Players with either total decreased | 0 |
| Players kept by any guard | 22 |
| Guarded fields | 44 |
| Players with stored caps > 0 at run start | 0 |
| Initially capped players guarded | 0 |
| Newly resolved players | 0 |
| Resolver failures | 3 |
| “In the Mix”: not on World Cup roster and caps >= 5 | 9 |

`playersUpdated` retains its existing meaning: rows written, including rows whose
guarded values remain unchanged. It is not the count of changed values.

**Noel Buck:** did not resolve; stored title remains null and totals remain 0/0.
A separate read-only inspection of the same Wikipedia search confirmed his
article was ranked first and had a valid football biography infobox, but its
only indexed national teams were England U19 and England U20. Keeping the
existing US-entry requirement therefore correctly rejected it.

**Unable to verify: Johnny Cardoso's real resolver outcome.** No Cardoso/Johnny
player exists in this development database. No player was added and no identity
rules were loosened to force a result.

**Unable to exercise the alarm against real capped development players:** all
stored caps were zero before the live run. Both guard directions and the alarm
were verified using the mocked assertion tests instead.

## Confirmed: verification

- `pnpm lint`: passed, with 8 warnings in untouched files.
- `pnpm typecheck`: passed.
- Full API suite with `--no-file-parallelism`: **116 files, 925 tests passed**.
  An earlier shell invocation was interrupted by its five-minute limit; the
  background rerun completed successfully.
- Full frontend suite: **19 files, 285 tests passed**.
- `PORT=5173 BASE_PATH=/ pnpm build`: passed. Non-fatal sourcemap diagnostics
  were emitted for existing UI modules.
- Code-generation drift check: passed.
- API workflow restarted successfully and listened on port 8080. Its log
  explicitly confirmed the existing national-team cooldown skipped startup sync,
  so the manual run was the only new real-Wikipedia sync.
- Development Player Pool screenshot rendered restored caps, including Pulisic
  at 90. Browser logs also showed inline-script CSP refusals and a 404; these
  unmodified frontend concerns were not changed as part of this parser fix.

The commit hash and the matching GitHub CI outcome are reported in the completion
message after pushing to `origin/main`. No production access or publishing.
