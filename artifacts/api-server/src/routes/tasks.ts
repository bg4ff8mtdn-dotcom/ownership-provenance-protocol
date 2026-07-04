import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, tasksTable, actorsTable, taskAcceptancesTable } from "@workspace/db";
import {
  CreateTaskBody,
  CreateTaskResponse,
  AcceptTaskParams,
  AcceptTaskBody,
  AcceptTaskResponse,
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

export default router;
