/**
 * Minimal object-storage serving route.
 * Only serves private object entities (uploaded invoices) and only to
 * requests that supply a valid admin session token.
 *
 * GET /storage/objects/* — streams the GCS object back to the caller.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { requireAdminSession } from "../lib/adminAuth";

const router: IRouter = Router();
const service = new ObjectStorageService();

/**
 * GET /storage/objects/:objectPath(*)
 * Serves a private stored object (e.g. an invoice PDF).
 * Protected by the same session token used by the transparency admin endpoints.
 */
router.get(
  "/storage/objects/*objectPath",
  requireAdminSession,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const rawParam = (req.params as Record<string, string | string[]>)["objectPath"] ?? "";
      const suffix = Array.isArray(rawParam) ? rawParam.join('/') : String(rawParam);
      const objectPath = `/objects/${suffix}`;
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
  },
);

export default router;
