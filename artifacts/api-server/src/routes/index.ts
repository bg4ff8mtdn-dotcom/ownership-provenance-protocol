import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tasksRouter);

export default router;
