import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
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
  ListUnacceptedTasksQueryParams,
  ListUnacceptedTasksResponse,
  GetTaskStatusParams,
  GetTaskStatusResponse,
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

  // Atomic ownership claim: a single conditional UPDATE that only succeeds
  // if no one currently holds ownership. This is the race-condition-proof
  // equivalent of the old unique constraint — there is no separate
  // read-then-write step, so two concurrent accept attempts cannot both
  // "see" a null owner and both proceed to write.
  const acceptance = await db.transaction(async (tx) => {
    const claimed = await tx
      .update(tasksTable)
      .set({ status: "accepted", currentOwnerActorId: actorId })
      .where(and(eq(tasksTable.id, taskId), isNull(tasksTable.currentOwnerActorId)))
      .returning({ id: tasksTable.id });

    if (claimed.length !== 1) {
      return null;
    }

    const [row] = await tx
      .insert(taskAcceptancesTable)
      .values({
        taskId,
        actorId,
        contextNote: contextNote ?? null,
      })
      .returning();

    return row;
  });

  if (!acceptance) {
    const [current] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
    req.log.warn(
      { taskId, currentOwnerActorId: current?.currentOwnerActorId, attemptedActorId: actorId },
      "Rejected task acceptance attempt: task already has a current owner",
    );
    res.status(409).json({
      error:
        current?.currentOwnerActorId === actorId
          ? `Task ${taskId} is already owned by ${actorId}`
          : `Task ${taskId} is already owned by ${current?.currentOwnerActorId}; ` +
            `${actorId} cannot accept it`,
    });
    return;
  }

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

  if (task.currentOwnerActorId === null) {
    req.log.warn(
      { taskId, attemptedActorId: actorId },
      "Rejected report_completion: task has no current owner",
    );
    res.status(409).json({
      error: `Task ${taskId} has no current owner; ${actorId} must call accept_task first`,
    });
    return;
  }

  if (task.currentOwnerActorId !== actorId) {
    req.log.warn(
      { taskId, currentOwnerActorId: task.currentOwnerActorId, attemptedActorId: actorId },
      "Rejected report_completion: caller is not the current owner",
    );
    res.status(403).json({
      error:
        `Task ${taskId} is currently owned by ${task.currentOwnerActorId}; ` +
        `${actorId} cannot report completion`,
    });
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

      if (task.currentOwnerActorId === null) {
        throw new Error(
          `Task ${taskId} has no current owner; ${fromActorId} cannot hand it off`,
        );
      }

      if (task.currentOwnerActorId !== fromActorId) {
        throw new Error(
          `Task ${taskId} is currently owned by ${task.currentOwnerActorId}, not ${fromActorId}; ` +
            `handoff rejected`,
        );
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

      await tx
        .update(tasksTable)
        .set({ status: "transitioned", currentOwnerActorId: null })
        .where(eq(tasksTable.id, taskId));

      return row;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to capture context snapshot";
    req.log.warn({ err, taskId, fromActorId }, "Rejected handoff");
    const status = message.startsWith(`Task ${taskId} not found`)
      ? 404
      : message.includes("cannot hand it off") || message.includes("handoff rejected")
        ? 403
        : 400;
    res.status(status).json({ error: message });
    return;
  }

  res.status(201).json(HandoffTaskResponse.parse(handoff));
});

router.get("/tasks/unaccepted", async (req, res): Promise<void> => {
  const query = ListUnacceptedTasksQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { actorId } = query.data;

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(
      actorId
        ? and(isNull(tasksTable.currentOwnerActorId), eq(tasksTable.injectedBy, actorId))
        : isNull(tasksTable.currentOwnerActorId),
    );

  res.status(200).json(ListUnacceptedTasksResponse.parse({ tasks }));
});

router.get("/tasks/:taskId/status", async (req, res): Promise<void> => {
  const params = GetTaskStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { taskId } = params.data;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: `Task ${taskId} not found` });
    return;
  }

  const [acceptance] = await db
    .select()
    .from(taskAcceptancesTable)
    .where(eq(taskAcceptancesTable.taskId, taskId))
    .orderBy(desc(taskAcceptancesTable.acceptedAt))
    .limit(1);

  const completions = await db
    .select()
    .from(taskCompletionsTable)
    .where(eq(taskCompletionsTable.taskId, taskId))
    .orderBy(taskCompletionsTable.reportedAt);

  // completions is chronological; the currently-applicable claim is simply
  // the last one reported. Kept as a distinct field rather than inferred
  // by callers, since multiple completions per task are allowed by design
  // (e.g. a corrected, better-verified claim superseding an earlier one).
  const latestCompletion = completions.length > 0 ? completions[completions.length - 1] : null;

  const handoffs = await db
    .select()
    .from(taskHandoffsTable)
    .where(eq(taskHandoffsTable.taskId, taskId))
    .orderBy(taskHandoffsTable.handoffAt);

  res.status(200).json(
    GetTaskStatusResponse.parse({
      task,
      acceptance: acceptance ?? null,
      completions,
      latestCompletion,
      handoffs,
    }),
  );
});

export default router;
