import Parser from "rss-parser";
import { db, playersTable, newsArticlesTable, newsArticlePlayersTable } from "@workspace/db";

import { logger } from "./logger";

const parser = new Parser({ timeout: 10_000 });

// Public RSS feeds that require no API key or paid signup. Google News RSS
// search feeds cover U.S. Soccer / MLS / club sites that don't publish their
// own reliable feeds.
const FEEDS: { url: string; source: string }[] = [
  { url: "https://feeds.bbci.co.uk/sport/football/rss.xml", source: "BBC Sport" },
  {
    url: "https://news.google.com/rss/search?q=USMNT+OR+%22US+men%27s+national+team%22+OR+%22USA+men%27s+national+team%22&hl=en-US&gl=US&ceid=US:en",
    source: "Google News",
  },
  {
    // ESPN's own RSS endpoint now returns a bot-challenge page instead of
    // XML, so we reach ESPN coverage indirectly via Google News instead.
    url: "https://news.google.com/rss/search?q=USMNT+site:espn.com&hl=en-US&gl=US&ceid=US:en",
    source: "ESPN (via Google News)",
  },
];

// Deliberately narrow: bare "U.S. Soccer" / "US soccer" is far too broad
// (matches youth academies, women's team, unrelated op-eds) and floods the
// feed with noise. Require phrasing that specifically names the men's senior
// national team.
const USMNT_KEYWORDS = ["usmnt", "u.s. men's national team", "us men's national team", "united states men's national team", "usa men's national team"];

// Cap how many freshly-ingested articles we keep per run so one noisy feed
// pull can't flood the news page — prioritize articles that name a tracked
// player over generic team-wide coverage.
const MAX_INSERTS_PER_RUN = 25;

/** Strips common outlet-name suffixes like "Headline - ESPN" or "Headline | ESPN" for cleaner display and de-duping. */
function cleanHeadline(title: string): string {
  return title.replace(/\s+[-–|]\s+[^-–|]{2,40}$/, "").trim();
}

/** Google News snippets are often just "<title> <outlet>" with no real summary — drop those. */
function cleanSummary(rawSummary: string, cleanedTitle: string): string {
  const normalized = rawSummary.replace(/<[^>]+>/g, "").trim();
  const withoutTitle = normalized.startsWith(cleanedTitle) ? normalized.slice(cleanedTitle.length).trim() : normalized;
  // If nothing but a trailing outlet name is left, there's no real summary content.
  if (withoutTitle.length < 15) return cleanedTitle;
  return normalized.slice(0, 400);
}

function categorize(text: string): string {
  const t = text.toLowerCase();
  if (/(injur|hamstring|ankle|acl|surger|out for)/.test(t)) return "Injuries";
  if (/(transfer|loan|sign|deal|move to|here we go)/.test(t)) return "Transfer Rumors";
  if (/(call-?up|roster|squad|preliminary|camp)/.test(t)) return "National Team Call-ups";
  if (/(goal|brace|hat-?trick|score[ds]?)/.test(t)) return "Goals";
  if (/(award|player of the|nomin|golden boy|ballon)/.test(t)) return "Awards";
  if (/(contract|extension|renew)/.test(t)) return "Contract Extensions";
  return "News";
}

/**
 * Fetches configured public RSS feeds, keeps only items relevant to tracked
 * USMNT players (or general USMNT/U.S. Soccer keywords), and inserts new
 * articles (deduped by URL) into news_articles + links matched players.
 *
 * No paid API key required — this is the free/RSS half of the hybrid data
 * pipeline. Live fixtures/stats still need a paid provider (see replit.md).
 */
interface Candidate {
  title: string;
  link: string;
  source: string;
  publishedAt: Date;
  category: string;
  summary: string;
  matchedPlayers: { id: number; name: string }[];
  dedupeKey: string;
}

export async function ingestRssNews(): Promise<{ fetched: number; inserted: number; feedsFailed: string[] }> {
  const players = await db.select({ id: playersTable.id, name: playersTable.name }).from(playersTable);
  const existingUrls = new Set((await db.select({ url: newsArticlesTable.url }).from(newsArticlesTable)).map((r) => r.url));
  const feedsFailed: string[] = [];
  let fetched = 0;

  const candidates: Candidate[] = [];
  const seenDedupeKeys = new Set<string>();

  for (const feed of FEEDS) {
    let parsed: Parser.Output<Record<string, unknown>>;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (err) {
      feedsFailed.push(feed.url);
      logger.warn({ err, feed: feed.url }, "RSS feed fetch failed");
      continue;
    }

    for (const item of parsed.items ?? []) {
      fetched++;
      const rawTitle = item.title?.trim();
      const link = item.link?.trim();
      if (!rawTitle || !link || existingUrls.has(link)) continue;

      const snippet = (item.contentSnippet || item.content || "").toString();
      const haystack = `${rawTitle} ${snippet}`.toLowerCase();

      const matchedPlayers = players.filter((p) => haystack.includes(p.name.toLowerCase()));
      const hasKeyword = USMNT_KEYWORDS.some((k) => haystack.includes(k));

      // Only keep articles that are actually about tracked players or the
      // senior men's national team — RSS feeds are broad (all of football),
      // most items are irrelevant noise.
      if (matchedPlayers.length === 0 && !hasKeyword) continue;

      const title = cleanHeadline(rawTitle);
      const dedupeKey = title.toLowerCase();
      if (seenDedupeKeys.has(dedupeKey)) continue;
      seenDedupeKeys.add(dedupeKey);

      const publishedAt = item.isoDate ? new Date(item.isoDate) : item.pubDate ? new Date(item.pubDate) : new Date();
      candidates.push({
        title,
        link,
        source: feed.source,
        publishedAt,
        category: categorize(haystack),
        summary: cleanSummary(snippet, title),
        matchedPlayers,
        dedupeKey,
      });
    }
  }

  // Prioritize articles naming a tracked player, then most recent, and cap
  // the batch so one noisy feed pull can't flood the news page.
  candidates.sort((a, b) => {
    if (a.matchedPlayers.length !== b.matchedPlayers.length) return b.matchedPlayers.length - a.matchedPlayers.length;
    return b.publishedAt.getTime() - a.publishedAt.getTime();
  });
  const toInsert = candidates.slice(0, MAX_INSERTS_PER_RUN);

  let inserted = 0;
  for (const c of toInsert) {
    const whyItMatters = c.matchedPlayers.length
      ? `Directly involves tracked USMNT player${c.matchedPlayers.length > 1 ? "s" : ""}: ${c.matchedPlayers.map((p) => p.name).join(", ")}.`
      : "Related to the U.S. Men's National Team.";

    const [article] = await db
      .insert(newsArticlesTable)
      .values({
        headline: c.title,
        source: c.source,
        publishedAt: c.publishedAt,
        category: c.category,
        url: c.link,
        summary: c.summary,
        whyItMatters,
        impactScore: c.matchedPlayers.length > 0 ? 6 : 4,
        sentiment: "neutral",
      })
      .returning({ id: newsArticlesTable.id });

    if (c.matchedPlayers.length > 0 && article) {
      await db.insert(newsArticlePlayersTable).values(c.matchedPlayers.map((p) => ({ articleId: article.id, playerId: p.id })));
    }
    inserted++;
  }

  logger.info({ fetched, candidates: candidates.length, inserted, feedsFailed }, "RSS news ingestion complete");
  return { fetched, inserted, feedsFailed };
}

let intervalHandle: NodeJS.Timeout | null = null;

/** Runs ingestion immediately, then on a recurring interval (default 15 min). */
export function startRssIngestionSchedule(intervalMs = 15 * 60 * 1000): void {
  ingestRssNews().catch((err) => logger.error({ err }, "Initial RSS ingestion failed"));
  intervalHandle = setInterval(() => {
    ingestRssNews().catch((err) => logger.error({ err }, "Scheduled RSS ingestion failed"));
  }, intervalMs);
}

export function stopRssIngestionSchedule(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}
