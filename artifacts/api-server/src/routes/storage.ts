/**
 * Minimal object-storage serving route.
 * Only serves private object entities (uploaded invoices) and only to
 * requests that supply a valid admin password.
 *
 * GET /storage/objects/* — streams the GCS object back to the caller.
 */
import { timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const service = new ObjectStorageService();

/**
 * GET /storage/objects/:objectPath(*)
 * Serves a private stored object (e.g. an invoice PDF).
 * Protected by the same ADMIN_PASSWORD Bearer token used by the transparency
 * admin endpoints.
 */
router.get("/storage/objects/*objectPath", async (req: Request, res: Response): Promise<void> => {
  const password = process.env["ADMIN_PASSWORD"];
  if (!password) {
    res.status(503).json({ error: "Not configured" });
    return;
  }

  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const tokenBuf = Buffer.from(token);
  const passBuf = Buffer.from(password);
  const match = tokenBuf.length === passBuf.length && timingSafeEqual(tokenBuf, passBuf);
  if (!match) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const objectPath = `/objects/${(req.params as Record<string, string>)["objectPath"] ?? ""}`;
    const signedUrl = await service.getObjectEntityDownloadUrl(objectPath, /* ttlSec */ 300);
    res.redirect(302, signedUrl);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Not found" });
    } else {
      logger.error({ err }, "Storage: failed to serve object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  }
});

export default router;
