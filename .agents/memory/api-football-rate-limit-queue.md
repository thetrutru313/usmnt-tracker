---
name: API-Football shared rate limiter must reserve slots synchronously
description: Why a naive "check lastRequestAt, sleep, then stamp it" throttle fails under concurrent callers, and the fix pattern used in apiFootballSync.ts's afFetch.
---

A throttle shaped like `wait = lastRequestAt + interval - now(); if (wait>0) await sleep(wait); lastRequestAt = now()` looks correct for a single serial caller, but is racy under concurrency: every caller that arrives before the first one wakes up reads the same stale `lastRequestAt`, computes the same wait, and they all fire together the moment they wake — the throttle does nothing once callers overlap.

**Why:** This project has multiple independent sync schedules (club fixtures, club stats, USMNT) that call a shared `afFetch` concurrently, and one sync itself fans out concurrent calls via `Promise.all`. That overlap reliably reproduced "Too many requests" (429) bursts from the provider even though a throttle already existed.

**How to apply:** Any shared outbound-rate-limiter must reserve the next slot *synchronously*, before awaiting anything: `const mySlot = Math.max(nextSlotAt, now()); nextSlotAt = mySlot + interval; if (mySlot > now()) await sleep(mySlot - now())`. Because JS doesn't yield until the `await`, concurrent callers each grab a strictly later slot before any of them sleeps. Verify by watching real logs across a full boot cycle (all schedules' immediate on-boot runs overlapping) — a race like this won't show up from reading the code's happy path alone.
