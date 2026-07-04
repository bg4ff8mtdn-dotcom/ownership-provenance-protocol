import { pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";
import { tasksTable } from "./tasks";

export const taskAcceptancesTable = pgTable(
  "task_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => actorsTable.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    contextNote: text("context_note"),
  },
  (table) => [
    // One acceptance per task, ever. This is the DB-level backstop that
    // prevents a second actor from ever overwriting the first acceptance,
    // even under concurrent requests.
    unique("task_acceptances_task_id_unique").on(table.taskId),
  ],
);

export const insertTaskAcceptanceSchema = createInsertSchema(taskAcceptancesTable).omit({
  id: true,
  acceptedAt: true,
});
export type InsertTaskAcceptance = z.infer<typeof insertTaskAcceptanceSchema>;
export type TaskAcceptance = typeof taskAcceptancesTable.$inferSelect;
