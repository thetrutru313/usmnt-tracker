---
name: API-Football player search quirks
description: Gotchas when resolving a player's API-Football id by name (used for the live player-club sync in the USMNT Tracker) — applies to any project matching people by name against this API.
---

`/players/profiles?search=` rejects a `"Firstname Lastname"` query outright with zero results if it doesn't match the API's own name format, and 400s on accented characters ("The Search field may only contain alpha-numeric characters and spaces" — e.g. "Sergiño Dest" or "Atlético Madrid" as a team search). Searching on the surname alone (ASCII-normalized) works far more reliably.

**Why:** confirmed via direct curl — `search=Christian Pulisic` returns 0 results while `search=Pulisic` returns 2. The API's `name` field is abbreviated ("C. Pulišić"), not `firstname lastname`, so exact-string matching against the stored full name fails even when the player is right there in the results.

**How to apply:** search on last name only. Then require an exact match on the response's structured `lastname` field AND a matching first-name initial (normalize both with accent-stripping) before accepting a candidate — do not just take `results[0]`. Common surnames collide across totally unrelated players even within one nationality: searching "Richards" for USMNT defender Chris Richards (real id 126949, "Christopher Jeffrey Richards") also returns an unrelated USA-nationality lower-league player "Brent Anthony Richards" (id 102616) with the same surname and nationality — only the first-name initial disambiguates them. A wrong id gets cached and silently misattributes that player's transfer history on every future sync run, which is worse than leaving the match unresolved for one run — prefer returning "no confident match" over guessing.
