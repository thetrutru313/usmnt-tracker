import { Router, type IRouter } from "express";
import { ListNewsQueryParams, ListNewsResponse } from "@workspace/api-zod";
import { db, newsArticlesTable, newsArticlePlayersTable } from "@workspace/db";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { attachPlayersToNews } from "../lib/queries";

const router: IRouter = Router();

router.get("/news", async (req, res): Promise<void> => {
  const parsed = ListNewsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { category, playerId, limit } = parsed.data;

  const conditions = [];
  if (category) conditions.push(ilike(newsArticlesTable.category, category));

  if (playerId) {
    const rows = await db
      .select({ articleId: newsArticlePlayersTable.articleId })
      .from(newsArticlePlayersTable)
      .where(eq(newsArticlePlayersTable.playerId, playerId));
    const articleIds = rows.map((r) => r.articleId);
    if (articleIds.length === 0) {
      res.json(ListNewsResponse.parse([]));
      return;
    }
    conditions.push(inArray(newsArticlesTable.id, articleIds));
  }

  let query = db
    .select()
    .from(newsArticlesTable)
    .orderBy(desc(newsArticlesTable.publishedAt))
    .$dynamic();

  if (conditions.length) query = query.where(and(...conditions));
  if (limit) query = query.limit(limit);

  const rows = await query;
  const withPlayers = await attachPlayersToNews(rows);
  res.json(ListNewsResponse.parse(withPlayers));
});

export default router;
