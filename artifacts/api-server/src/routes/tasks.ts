import { Router, type IRouter } from "express";
import { db, tasksTable } from "@workspace/db";
import { CreateTaskBody, CreateTaskResponse } from "@workspace/api-zod";

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

export default router;
