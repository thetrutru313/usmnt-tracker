import { Router, type IRouter } from "express";
import { ListTransfersQueryParams, ListTransfersResponse } from "@workspace/api-zod";
import { desc, eq, transfersTable, transfersWithPlayerQuery, withTransferBadges } from "../lib/queries";

const router: IRouter = Router();

router.get("/transfers", async (req, res): Promise<void> => {
  const parsed = ListTransfersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { status } = parsed.data;

  const query = transfersWithPlayerQuery().orderBy(desc(transfersTable.announcedAt));
  const raw = status ? await query.where(eq(transfersTable.status, status)) : await query;
  const rows = await withTransferBadges(raw);

  res.json(ListTransfersResponse.parse(rows));
});

export default router;
