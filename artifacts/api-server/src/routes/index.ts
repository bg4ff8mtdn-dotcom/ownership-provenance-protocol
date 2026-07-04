import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tasksRouter from "./tasks";
import { bearerAuth } from "../middlewares/bearerAuth";

const router: IRouter = Router();

// /healthz must stay open (no bearer token) so deployment health checks can
// reach it without configuring a secret. Every other /api/* route requires
// the same shared-secret bearer token as /mcp.
router.use(healthRouter);
router.use(bearerAuth, tasksRouter);

export default router;
