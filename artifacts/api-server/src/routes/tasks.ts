import { Router, type IRouter } from "express";
import {
  CreateTaskBody,
  CreateTaskResponse,
  AcceptTaskParams,
  AcceptTaskBody,
  AcceptTaskResponse,
  ReportCompletionParams,
  ReportCompletionBody,
  ReportCompletionResponse,
  HandoffTaskParams,
  HandoffTaskBody,
  HandoffTaskResponse,
  ListUnacceptedTasksQueryParams,
  ListUnacceptedTasksResponse,
  GetTaskStatusParams,
  GetTaskStatusResponse,
} from "@workspace/api-zod";
import * as taskService from "../services/taskService";

const router: IRouter = Router();

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid create task body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await taskService.createTask(parsed.data);
  res.status(result.status).json(result.ok ? CreateTaskResponse.parse(result.data) : { error: result.error });
});

router.post("/tasks/:taskId/accept", async (req, res): Promise<void> => {
  const params = AcceptTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = AcceptTaskBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid accept task body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await taskService.acceptTask(params.data.taskId, parsed.data);
  if (!result.ok) {
    req.log.warn(
      { taskId: params.data.taskId, attemptedActorId: parsed.data.actorId, error: result.error },
      "Rejected task acceptance attempt",
    );
  }
  res.status(result.status).json(result.ok ? AcceptTaskResponse.parse(result.data) : { error: result.error });
});

router.post("/tasks/:taskId/complete", async (req, res): Promise<void> => {
  const params = ReportCompletionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = ReportCompletionBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn(
      { errors: parsed.error.message },
      "Rejected report_completion: missing or invalid provenance (or other invalid input)",
    );
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await taskService.reportCompletion(params.data.taskId, parsed.data);
  if (!result.ok) {
    req.log.warn(
      { taskId: params.data.taskId, attemptedActorId: parsed.data.actorId, error: result.error },
      "Rejected report_completion",
    );
  }
  res
    .status(result.status)
    .json(result.ok ? ReportCompletionResponse.parse(result.data) : { error: result.error });
});

router.post("/tasks/:taskId/handoff", async (req, res): Promise<void> => {
  const params = HandoffTaskParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = HandoffTaskBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid handoff task body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await taskService.handoffTask(params.data.taskId, parsed.data);
  if (!result.ok) {
    req.log.warn(
      { taskId: params.data.taskId, fromActorId: parsed.data.fromActorId, error: result.error },
      "Rejected handoff",
    );
  }
  res.status(result.status).json(result.ok ? HandoffTaskResponse.parse(result.data) : { error: result.error });
});

router.get("/tasks/unaccepted", async (req, res): Promise<void> => {
  const query = ListUnacceptedTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const result = await taskService.listUnacceptedTasks(query.data);
  res
    .status(result.status)
    .json(result.ok ? ListUnacceptedTasksResponse.parse(result.data) : { error: result.error });
});

router.get("/tasks/:taskId/status", async (req, res): Promise<void> => {
  const params = GetTaskStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const result = await taskService.getTaskStatus(params.data.taskId);
  res.status(result.status).json(result.ok ? GetTaskStatusResponse.parse(result.data) : { error: result.error });
});

export default router;
