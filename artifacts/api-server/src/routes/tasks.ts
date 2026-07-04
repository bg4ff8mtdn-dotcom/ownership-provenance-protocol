import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  tasksTable,
  actorsTable,
  taskAcceptancesTable,
  taskCompletionsTable,
  taskHandoffsTable,
} from "@workspace/db";
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
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/tasks", async (req, res): Promise<void> => {
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid create task body");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [task] = await db
    .insert(tasksTable)
    .values({
      title: parsed.data.title,
      description: parsed.data.description,
      injectedBy: parsed.data.injectedBy,
      authorityScope: parsed.data.authorityScope ?? null,
    })
    .returning();

  res.status(201).json(CreateTaskResponse.parse(task));
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

  const { taskId } = params.data;
  const { actorId, contextNote } = parsed.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: `Task ${taskId} not found` });
    return;
  }

  const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
  if (!actor) {
    res.status(404).json({ error: `Actor ${actorId} not found` });
    return;
  }

  const [existingAcceptance] = await db
    .select()
    .from(taskAcceptancesTable)
    .where(eq(taskAcceptancesTable.taskId, taskId));

  if (existingAcceptance) {
    req.log.warn(
      { taskId, existingActorId: existingAcceptance.actorId, attemptedActorId: actorId },
      "Rejected duplicate task acceptance attempt",
    );
    res.status(409).json({
      error:
        existingAcceptance.actorId === actorId
          ? `Task ${taskId} was already accepted by ${actorId}`
          : `Task ${taskId} was already accepted by ${existingAcceptance.actorId}; ` +
            `${actorId} cannot accept it`,
    });
    return;
  }

  const acceptance = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(taskAcceptancesTable)
      .values({
        taskId,
        actorId,
        contextNote: contextNote ?? null,
      })
      .returning();

    await tx.update(tasksTable).set({ status: "accepted" }).where(eq(tasksTable.id, taskId));

    return row;
  });

  res.status(201).json(AcceptTaskResponse.parse(acceptance));
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

  const { taskId } = params.data;
  const { actorId, provenance, claimText, sourceReference } = parsed.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: `Task ${taskId} not found` });
    return;
  }

  const [actor] = await db.select().from(actorsTable).where(eq(actorsTable.id, actorId));
  if (!actor) {
    res.status(404).json({ error: `Actor ${actorId} not found` });
    return;
  }

  const completion = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(taskCompletionsTable)
      .values({
        taskId,
        actorId,
        provenance,
        claimText,
        sourceReference: sourceReference ?? null,
      })
      .returning();

    await tx.update(tasksTable).set({ status: "completed" }).where(eq(tasksTable.id, taskId));

    return row;
  });

  res.status(201).json(ReportCompletionResponse.parse(completion));
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

  const { taskId } = params.data;
  const { fromActorId, toActorId, reason } = parsed.data;

  const [fromActor] = await db.select().from(actorsTable).where(eq(actorsTable.id, fromActorId));
  if (!fromActor) {
    res.status(404).json({ error: `Actor ${fromActorId} not found` });
    return;
  }

  const [toActor] = await db.select().from(actorsTable).where(eq(actorsTable.id, toActorId));
  if (!toActor) {
    res.status(404).json({ error: `Actor ${toActorId} not found` });
    return;
  }

  let handoff;
  try {
    handoff = await db.transaction(async (tx) => {
      // Capture the context snapshot inside the same transaction so it
      // reflects a single, consistent moment in time.
      const [task] = await tx.select().from(tasksTable).where(eq(tasksTable.id, taskId));
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      const [latestAcceptance] = await tx
        .select()
        .from(taskAcceptancesTable)
        .where(eq(taskAcceptancesTable.taskId, taskId))
        .orderBy(desc(taskAcceptancesTable.acceptedAt))
        .limit(1);

      const [latestCompletion] = await tx
        .select()
        .from(taskCompletionsTable)
        .where(eq(taskCompletionsTable.taskId, taskId))
        .orderBy(desc(taskCompletionsTable.reportedAt))
        .limit(1);

      const contextSnapshot = {
        capturedAt: new Date().toISOString(),
        status: task.status,
        latestAcceptance: latestAcceptance
          ? {
              id: latestAcceptance.id,
              actorId: latestAcceptance.actorId,
              acceptedAt: latestAcceptance.acceptedAt,
              contextNote: latestAcceptance.contextNote,
            }
          : null,
        latestCompletion: latestCompletion
          ? {
              id: latestCompletion.id,
              actorId: latestCompletion.actorId,
              provenance: latestCompletion.provenance,
              claimText: latestCompletion.claimText,
              sourceReference: latestCompletion.sourceReference,
              reportedAt: latestCompletion.reportedAt,
            }
          : null,
      };

      // Defensive check: never allow an empty/null snapshot to be persisted,
      // even though contextSnapshot is NOT NULL at the DB level too.
      if (!contextSnapshot || typeof contextSnapshot !== "object") {
        throw new Error("Failed to capture a valid context snapshot");
      }

      const [row] = await tx
        .insert(taskHandoffsTable)
        .values({
          taskId,
          fromActorId,
          toActorId,
          reason: reason ?? null,
          contextSnapshot,
        })
        .returning();

      await tx.update(tasksTable).set({ status: "transitioned" }).where(eq(tasksTable.id, taskId));

      return row;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to capture context snapshot";
    req.log.error({ err, taskId }, "Rejected handoff: could not capture context snapshot");
    const status = message.startsWith(`Task ${taskId} not found`) ? 404 : 400;
    res.status(status).json({ error: message });
    return;
  }

  res.status(201).json(HandoffTaskResponse.parse(handoff));
});

export default router;
