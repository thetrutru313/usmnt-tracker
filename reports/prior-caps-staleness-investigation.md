# Investigation: `prior_youth_nt_caps` NULL and stale `DUAL_NATIONAL` flags

**Scope:** Read-only. No code or data was changed while producing this report.

---

## 1. Does `rescoreAllCandidates` write the cap columns?

**Yes — both columns are written, alongside score and status, in the same
update call** (`artifacts/api-server/src/lib/playerDiscovery.ts`):

```ts
await dbInstance
  .update(playerCandidatesTable)
  .set({
    eligibilityConfidence: score,
    usmntStatus: status,
    dataSources: ["api_football"],
    dateOfBirth,
    priorNationalTeamCaps: seniorCaps > 0 ? seniorCaps : null,
    priorYouthNtCaps: youthCaps > 0 ? youthCaps : null,
    lastScoredAt: new Date(),
    // Demote below-threshold or over-age candidates to avoid surfacing low-quality noise
    ...(score < minScore || isOverAge ? { status: "dismissed" as const } : {}),
  })
  .where(eq(playerCandidatesTable.id, candidate.id));
```

`seniorCaps`/`youthCaps` come from `countNationalTeamCaps(profile.statistics)`
just above this call, using the corrected team-identity gate. `0` is stored
as `NULL`, not `0` — that convention was already in place before this fix.

**Important — this is not the only writer.** The *discovery* pass
(`discoverUSProspects`, same file) runs the identical scoring calls
(`evaluateEligibility`, `countNationalTeamCaps`) and writes the same two
columns on every insert/upsert, but it does **not** stamp `lastScoredAt`:

```ts
.values({
  ...
  priorNationalTeamCaps: seniorCaps > 0 ? seniorCaps : null,
  priorYouthNtCaps: youthCaps > 0 ? youthCaps : null,
  ...
  usmntStatus: status,
  ...
})
.onConflictDoUpdate({
  target: playerCandidatesTable.apiFootballPlayerId,
  set: {
    ...
    priorNationalTeamCaps: seniorCaps > 0 ? seniorCaps : null,
    priorYouthNtCaps: youthCaps > 0 ? youthCaps : null,
    ...
  },
})
```

So a candidate's cap columns can be populated by discovery alone, with
`lastScoredAt` remaining `NULL` until a rescore pass actually reaches it —
this is central to question 3.

---

## 2. Candidate 137 — name mismatch found

**Candidate id 137 in the current database is "J. McGlynn", not "Stas
Kornzeniowski."** It has never been scored at all:

| Column | Value |
|---|---|
| `usmnt_status` | `NULL` |
| `prior_national_team_caps` | `NULL` |
| `prior_youth_nt_caps` | `NULL` |
| `eligibility_confidence` | `NULL` |
| `last_scored_at` | `NULL` |
| `status` | `pending` |

"Stas Kornzeniowski" is actually **candidate id 963** (API-Football player id
512951). Reporting on that candidate instead, since it matches the name you
asked about:

### Stored DB state (id 963)

| Column | Value |
|---|---|
| `usmnt_status` | `DUAL_NATIONAL` |
| `prior_national_team_caps` | `3` |
| `prior_youth_nt_caps` | `NULL` |
| `eligibility_confidence` | `70` |
| `last_scored_at` | **`NULL`** — never touched by `rescoreAllCandidates` |
| `is_manual_override` | `false` |

### Live recompute right now (corrected logic, fresh API-Football data)

Fetched the same two seasons the app fetches (2026, 2025) and ran
`detectSeniorNonUsCaps` / `countNationalTeamCaps` against each:

**Season 2026 (3 stat blocks):**
| Team | League | Lineups | `isNationalTeamComp` | `resolveIsNational` |
|---|---|---|---|---|
| Philadelphia Union (id 1599) | CONCACAF Champions League | 3 | true | **false** (real club team id) |
| Philadelphia Union (id 1599) | Leagues Cup | 1 | false | — |
| Philadelphia Union (id 1599) | Major League Soccer | 1 | false | — |

→ `detectSeniorNonUsCaps` = **false**, `countNationalTeamCaps` = `{seniorCaps: 0, youthCaps: 0}`

**Season 2025 (3 stat blocks):**
| Team | League | Lineups | `isNationalTeamComp` | `resolveIsNational` |
|---|---|---|---|---|
| Philadelphia Union II (id 3988) | MLS Next Pro | 5 | false | — |
| Philadelphia Union (id 1599) | US Open Cup | 0 | false | — |
| Philadelphia Union (id 1599) | Major League Soccer | 0 | false | — |

→ `detectSeniorNonUsCaps` = **false**, `countNationalTeamCaps` = `{seniorCaps: 0, youthCaps: 0}`

**Conclusion for candidate 963:** re-evaluated right now with the corrected
logic against live data, this candidate has **0 senior caps, 0 youth caps,
and should not be `DUAL_NATIONAL`**. The only stat block that even reaches
the team-identity check is the CONCACAF Champions League block for his own
club (Philadelphia Union), and it correctly resolves as **not** national.
This directly contradicts the stored `DUAL_NATIONAL` / `3` caps values.

**Why the DB disagrees with a live recompute:** `last_scored_at` is `NULL`
for this row, meaning `rescoreAllCandidates` has never run against it since
it was discovered. Its current `usmnt_status`/`prior_national_team_caps`
values were written by the **discovery** insert/upsert path, at whatever
point in time that ran — using the same corrected functions, but against
whatever live API-Football data existed *then*. API-Football's stats feed
is live and mutable (match results, squad data, and season rollovers change
it), so a value that was correct at discovery time can go stale later
without anything being "wrong" in the code. This candidate's cap numbers
will only refresh the next time it's actually picked up by a rescore pass.

---

## 3. Are the review-queue cap numbers current?

**Plainly: no, not reliably.** The write logic is correct and does run on
every rescore — but a large share of candidates have **never actually been
rescored**, so their stored numbers reflect whatever was true at discovery
time, which can be stale:

| | Count |
|---|---|
| Total candidates | 165 |
| Never rescored (`last_scored_at IS NULL`) | **93 (56%)** |
| Rescored at least once | 72 |
| `DUAL_NATIONAL` candidates never rescored | 4 of 31 |
| `DUAL_NATIONAL` candidates rescored at least once | 27 of 31 |
| Candidates with `prior_youth_nt_caps` populated (non-NULL) | **0 of 165** |

Two separate things are going on, and they should not be conflated:

- **Staleness (confirmed, candidate 963 above):** rows with `last_scored_at
  IS NULL` are showing discovery-time snapshots, not current data. Whether
  a given row's number is still accurate depends entirely on whether the
  underlying API-Football stats for that player have changed since
  discovery — there's no way to tell from the stored row alone. Given
  `rescoreAllCandidates` runs on a fixed schedule with a cap of 50
  candidates per run (`RESCORE_MAX_CANDIDATES`, default 50) rather than at
  server startup, more than half the pool sitting at `last_scored_at =
  NULL` means the backlog has not caught up.
- **`prior_youth_nt_caps` being NULL for literally every row (not just
  most)** is more than a staleness story — it held even for the 72 rows
  that *have* been rescored. That's consistent with youth caps being
  genuinely rare in this dataset, but it's also consistent with a separate,
  **pre-existing and unrelated-to-this-fix** filter: `isNationalTeamComp`
  excludes any league name matching `/friendly|friendlies/i` before a stat
  block is even considered a national-team competition. API-Football
  commonly categorizes youth (and some senior) international appearances
  under a "Friendlies" league. If that's happening here, those appearances
  would never reach the team-identity check at all, for youth *or* senior
  caps — I did not find one in the two players sampled in depth, so this is
  flagged as a hypothesis worth checking on a dataset of confirmed
  youth-capped candidates, not a confirmed cause.

**Bottom line:** treat every `prior_national_team_caps` /
`prior_youth_nt_caps` / `usmnt_status` value in the review queue with
`last_scored_at = NULL` as **not current** — it predates the fix's
production impact assessment and may no longer match live data. Values with
a non-null `last_scored_at` reflect the corrected logic as of that
timestamp, but can still drift stale between rescore passes since the
underlying feed is live.
