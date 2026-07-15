---
name: National-team caps/goals data source
description: Why ESPN and Wikidata were rejected as sources for USMNT senior caps/goals, and the gotchas in the Wikipedia-infobox approach that replaced them.
---

For per-player senior national-team career totals (caps/goals), neither the obvious paid nor "structured data" sources worked well:

- **ESPN's site API** (`site.api.espn.com`/`site.web.api.espn.com`) only exposes *per-season, per-competition* splits (e.g. "2026 FIFA World Cup: 4 appearances"), never a career-aggregate field. Rebuilding a career total would mean iterating every season since debut against an undocumented API — not reliable.
- **Wikidata's structured claims** (P54 "member of sports team", qualified by P1350 matches/P1351 goals) model the relationship correctly, but empirically many current senior internationals (e.g. Tyler Adams, Yunus Musah at the time this was checked) have the P54 claim for the senior team with the P1350/P1351 qualifiers simply left blank by editors, even though a *different* claim (a youth team, or the same team at a different rank) has them filled in. Trusting P54 qualifiers alone silently under-reports capped players to 0 — worse than not having the data, since it looks like real "0 caps" rather than "unknown."

**What works:** parsing the wikitext of the player's English Wikipedia article directly, via `{{Infobox football biography}}` (or the `soccer biography` variant — see below) parameters `nationalteamN`/`nationalcapsN`/`nationalgoalsN`. Wikipedia's infobox is what editors actually keep current; pick the entry where `nationalteamN` contains "United States" and excludes youth-team entries (regex `/under-?\d/`).

**Why:** confirmed by direct comparison — Wikidata claims were stale/incomplete for exactly the same players whose Wikipedia infobox had correct, current numbers.

**How to apply:**
- Some US-context football bios use `{{Infobox soccer biography}}` instead of `{{Infobox football biography}}` — check for both, or a resolver will silently reject valid pages (confirmed: Yunus Musah, Giovanni Reyna, and others use the "soccer" variant).
- MediaWiki's `generator=search` API returns matching pages keyed by pageid in a `pages` object — **iteration order is not relevance order**. Each page has an `index` field with the real rank; sort on it explicitly before picking the "top" result, or you'll silently pick an arbitrary (often wrong) candidate.
- Search-relevance + "is a footballer with a US national-team appearance" is *not* a safe identity check on its own — confirmed cross-matches in testing: a search for one player resolved to a completely different player's (or relative's) article (e.g. "Giovanni Reyna" search matching his father "Claudio Reyna", "Paxten Aaronson" matching his brother "Brenden Aaronson"). Always additionally verify the resolved article's title (stripped of Wikipedia disambiguation parentheses) matches the searched name.
- Anonymous traffic to Wikimedia's API (both Wikidata's and Wikipedia's `w/api.php`) gets 429'd quickly from this environment's shared IP if requests aren't well spaced — throttle to ~1 req/sec and honor `Retry-After` with exponential backoff on 429, same pattern as the API-Football sync's throttle.
- Nicknames aren't handled (e.g. "Gaga Slonina" vs. his actual Wikipedia title "Gabriel Slonina") — these are left unresolved (0/0) rather than guessed, consistent with the "don't guess on ambiguity" posture used elsewhere in this codebase (see `api-football-player-search.md`).
