import { Router, type IRouter } from "express";
import healthRouter from "./health";
import playersRouter from "./players";
import fixturesRouter from "./fixtures";
import newsRouter from "./news";
import injuriesRouter from "./injuries";
import transfersRouter from "./transfers";
import dashboardRouter from "./dashboard";
import rankingsRouter from "./rankings";
import searchRouter from "./search";
import adminRouter from "./admin";
import scheduleRouter from "./schedule";
import transparencyRouter from "./transparency";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(playersRouter);
router.use(fixturesRouter);
router.use(newsRouter);
router.use(injuriesRouter);
router.use(transfersRouter);
router.use(dashboardRouter);
router.use(rankingsRouter);
router.use(searchRouter);
router.use(adminRouter);
router.use(scheduleRouter);
router.use(transparencyRouter);
router.use(storageRouter);

export default router;
