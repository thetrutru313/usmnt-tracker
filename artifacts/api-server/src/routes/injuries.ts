import { Router, type IRouter } from "express";
import { ListInjuriesQueryParams, ListInjuriesResponse } from "@workspace/api-zod";
import { desc, eq, injuriesTable, injuriesWithPlayerQuery, withInjuryBadges } from "../lib/queries";

const router: IRouter = Router();

router.get("/injuries", async (req, res): Promise<void> => {
  const parsed = ListInjuriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status } = parsed.data;

  const query = injuriesWithPlayerQuery().orderBy(desc(injuriesTable.startDate));
  const raw = status ? await query.where(eq(injuriesTable.status, status)) : await query;
  const rows = await withInjuryBadges(raw);

  res.json(ListInjuriesResponse.parse(rows));
});

export default router;
