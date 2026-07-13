import { Router, type IRouter } from "express";
import { ListInjuriesQueryParams, ListInjuriesResponse } from "@workspace/api-zod";
import { desc, eq, injuriesTable, injuriesWithPlayerQuery } from "../lib/queries";

const router: IRouter = Router();

router.get("/injuries", async (req, res): Promise<void> => {
  const parsed = ListInjuriesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status } = parsed.data;

  const query = injuriesWithPlayerQuery().orderBy(desc(injuriesTable.startDate));
  const rows = status ? await query.where(eq(injuriesTable.status, status)) : await query;

  res.json(ListInjuriesResponse.parse(rows));
});

export default router;
