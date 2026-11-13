/**
 * News tagging and duplicate articles (review D10).
 *
 * Change-verifying (fail before batch 3):
 * 1. A player is tagged by a news alias ("Gio Reyna" for Giovanni Reyna).
 * 2. Names match without accents ("Castaneda" tags "Castañeda").
 * 3. Aliases under 5 characters are ignored.
 * 4. The same URL is stored once, even under two headlines in one run
 *    (unique index + ON CONFLICT DO NOTHING), and the alias-matched article
 *    is linked to its player.
 *
 * Test 4 runs ingestRssNews() against the dev database inside a rolled-back
 * transaction, with the RSS feeds mocked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, clubsTable, playersTable, newsArticlesTable, newsArticlePlayersTable } from "@workspace/db";
import { eq, like } from "drizzle-orm";

const state = vi.hoisted(() => ({ transaction: null as unknown, parseURL: vi.fn() }));
vi.mock("rss-parser", () => ({
  default: class { parseURL = state.parseURL; },
}));
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, property) {
        const source = (state.transaction ?? target) as typeof actual.db;
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

import { ingestRssNews, normalizeForMatch, playersMentioned, type NewsPlayer } from "../rssIngest";

afterEach(() => {
  state.parseURL.mockReset();
});

const players: NewsPlayer[] = [
  { id: 1, name: "Giovanni Reyna", newsAliases: ["Gio Reyna"] },
  { id: 2, name: "Diego Castañeda", newsAliases: [] },
  { id: 3, name: "Timothy Weah", newsAliases: ["Tim Weah", "Tim"] },
];

describe("playersMentioned", () => {
  it("1: tags a player by a news alias, case-insensitively", () => {
    expect(playersMentioned("GIO REYNA scores for Gladbach", players)).toEqual([{ id: 1, name: "Giovanni Reyna" }]);
    expect(playersMentioned("Giovanni Reyna returns", players)).toEqual([{ id: 1, name: "Giovanni Reyna" }]);
  });

  it("2: matches names with or without accents", () => {
    expect(normalizeForMatch("Castañeda")).toBe("castaneda");
    expect(playersMentioned("Diego Castaneda called up", players).map((p) => p.id)).toEqual([2]);
    expect(playersMentioned("Diego Castañeda called up", players).map((p) => p.id)).toEqual([2]);
  });

  it("3: ignores aliases under 5 characters", () => {
    expect(playersMentioned("Tim Ream starts", players)).toEqual([]);
    expect(playersMentioned("Tim Weah starts", players).map((p) => p.id)).toEqual([3]);
  });
});

describe("ingestRssNews", () => {
  it("4: stores a URL once and links alias-matched articles", async () => {
    const run = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const aliasUrl = `https://example.test/__news-${run}-alias`;
    const dupUrl = `https://example.test/__news-${run}-dup`;
    const alias = `Zzqx Testalias ${run}`;
    const item = (title: string, link: string) => ({ title, link, contentSnippet: "", isoDate: "2099-01-01T12:00:00Z" });
    // First feed only; the other feeds are empty.
    state.parseURL.mockResolvedValue({ items: [] });
    state.parseURL.mockResolvedValueOnce({
      items: [
        item(`${alias} scores twice`, aliasUrl),
        item(`USMNT camp notes ${run}`, dupUrl),
        item(`USMNT camp notes, part two ${run}`, dupUrl),
      ],
    });

    const rollback = new Error("roll back news ingest test");
    try {
      await db.transaction(async (tx) => {
        state.transaction = tx;
        const [club] = await tx.insert(clubsTable)
          .values({ name: `__news club ${run}`, league: "Test", country: "USA" })
          .returning({ id: clubsTable.id });
        const [player] = await tx.insert(playersTable)
          .values({
            name: `Zzqx Fullname ${run}`, slug: `__news-player-${run}`, position: "MF", category: "prospect",
            age: 20, clubId: club!.id, newsAliases: [alias],
          })
          .returning({ id: playersTable.id });

        const result = await ingestRssNews();
        expect(result.inserted).toBe(2);

        const stored = await tx.select().from(newsArticlesTable).where(like(newsArticlesTable.url, `https://example.test/__news-${run}%`));
        expect(stored.map((a) => a.url).sort()).toEqual([aliasUrl, dupUrl].sort());

        const aliasArticle = stored.find((a) => a.url === aliasUrl)!;
        const links = await tx.select().from(newsArticlePlayersTable).where(eq(newsArticlePlayersTable.articleId, aliasArticle.id));
        expect(links.map((l) => l.playerId)).toEqual([player!.id]);

        // A later run (e.g. another instance) can't store the same URL again.
        await expect(
          tx.insert(newsArticlesTable).values({
            headline: "dup", source: "Test", publishedAt: new Date(), category: "News", url: dupUrl, summary: "", whyItMatters: "",
          }),
        ).rejects.toThrow();
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      state.transaction = null;
    }
  }, 30_000);
});
