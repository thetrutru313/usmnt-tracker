---
name: API-Football player search quirks
description: Gotchas when resolving a player's API-Football id by name (used for the live player-club sync in the USMNT Tracker) — applies to any project matching people by name against this API.
---

`/players/profiles?search=` rejects a `"Firstname Lastname"` query outright with zero results if it doesn't match the API's own name format, and 400s on accented characters ("The Search field may only contain alpha-numeric characters and spaces" — e.g. "Sergiño Dest" or "Atlético Madrid" as a team search). Searching on the surname alone (ASCII-normalized) works far more reliably.

**Why:** confirmed via direct curl — `search=Christian Pulisic` returns 0 results while `search=Pulisic` returns 2. The API's `name` field is abbreviated ("C. Pulišić"), not `firstname lastname`, so exact-string matching against the stored full name fails even when the player is right there in the results.

**How to apply:** search on last name only. Then require an exact match on the response's structured `lastname` field AND a matching first-name initial (normalize both with accent-stripping) before accepting a candidate — do not just take `results[0]`. Common surnames collide across totally unrelated players even within one nationality: searching "Richards" for USMNT defender Chris Richards (real id 126949, "Christopher Jeffrey Richards") also returns an unrelated USA-nationality lower-league player "Brent Anthony Richards" (id 102616) with the same surname and nationality — only the first-name initial disambiguates them. A wrong id gets cached and silently misattributes that player's transfer history on every future sync run, which is worse than leaving the match unresolved for one run — prefer returning "no confident match" over guessing.

## Nicknames and compound surnames also defeat the strict matcher

Two more patterns cause a genuinely correct player to fail the exact-surname + first-initial check (as distinct from the ambiguous-surname case above, where rejecting is correct): (1) API-Football's structured `firstname` is sometimes the player's *legal* name, not the nickname we store — e.g. Gaga Slonina's `firstname` is "Nicholas", Tanner Tessmann's is "Francis" — so the initial never matches even though it's the right person; (2) Latino players often carry both paternal+maternal surnames in `lastname` (e.g. "Zendejas Saavedra", "Gómez Vargas") while our stored name has only one surname word, so an exact-equality surname check also rejects the right person.

**Why:** confirmed by manually cross-checking candidates against `/players/teams?player=<id>` history (club/country matches our seeded data) and `/players?id=<id>&season=<year>` — e.g. Slonina's id shows prior Chicago Fire seasons, Zendejas's shows Club America seasons, matching known bios despite failing the strict name check.

**How to apply:** when the automated matcher reports "no confident match" for a specific player, don't assume they're just missing from the API — search the surname, then manually verify remaining candidates via `/players/teams` (does the club/national-team history match what we know about this player?) before accepting an id. A fix to the matcher itself (loosen surname to word-match against multi-word `lastname`, and/or a manual nickname override map) is tracked as a follow-up rather than done ad hoc per player.
