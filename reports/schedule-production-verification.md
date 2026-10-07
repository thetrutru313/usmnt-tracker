# USMNT schedule rebuild — production verification

Production URL: https://usmnt-tracker.replit.app

This report records the completed read-only verification after the user executed the schedule rebuild DO block. No checks were rerun to create this download.

## Check 1 — Production rows

**Confirmed — PASS:** Production contains **14 rows**.

**Confirmed — PASS:** Compared every row against `lib/db/src/seeds/scheduleEventsData.ts` at HEAD **`a82b106504fa077a57a5274a442df3da579e6cad`**, checking all nine fields: `slug`, `name`, `kind`, `status`, `startDate`, `endDate`, `dateLabel`, `description`, and `sortOrder`. **No differences**, including descriptions and null dates.

**Confirmed — PASS:** These retired slugs are absent:

- `cnl-f4-gold-cup-2027`
- `wcq-begins-2027`
- `wcq-2028-2029`

**Confirmed — PASS:** No duplicate slugs.

## Check 2 — Production schedule API

**Confirmed — PASS:** `GET https://usmnt-tracker.replit.app/api/schedule` returned **HTTP 200**, with **14 events**.

**Confirmed:** Returned order and attached fixture counts:

| Order | Slug | Fixtures |
|---:|---|---:|
| 1 | `friendlies-sept-2026` | 2 |
| 2 | `friendlies-oct-2026` | 2 |
| 3 | `cnl-qf-nov-2026` | 2 |
| 4 | `cnl-finals-mar-2027` | 0 |
| 5 | `friendlies-jun-2027` | 0 |
| 6 | `gold-cup-2027` | 0 |
| 7 | `friendlies-sept-2027` | 0 |
| 8 | `wcq-r2-2027` | 0 |
| 9 | `wcq-final-jun-2028` | 0 |
| 10 | `copa-america-2028` | 0 |
| 11 | `cnl-2028-29` | 0 |
| 12 | `gold-cup-2029` | 0 |
| 13 | `wcq-final-sept-2029` | 0 |
| 14 | `world-cup-2030` | 0 |

**Confirmed — PASS:** November has exactly two fixtures: **Haiti vs USA** and **USA vs Haiti**.

**Confirmed — PASS:** Every event starting in 2027 or later has zero fixtures.

**Confirmed — informational only:** September and October 2026 each have two fixtures; neither count is classified as pass or fail.

## Check 3 — Production dashboard hero

**Confirmed — PASS:** `GET /api/dashboard` returned **HTTP 200**. Its `nextScheduleEvent.slug` is **`cnl-qf-nov-2026`**, as expected.

## Check 4 — Is commit `abe9999` live?

**Confirmed — FAIL:** Exactly one `GET /api/schedule` request was sent with `Origin: https://not-allowed.example`.

- HTTP status: **500**
- Response body shape: **non-JSON text**

**Confirmed:** Under the specified diagnostic criterion, **`abe9999` is not published**. No retry or fix was performed.

No writes were performed during verification. The subsequent, user-requested export created only `reports/schedule-production-verification.md`; no database writes, commits, pushes, publishes, or restarts were performed.
