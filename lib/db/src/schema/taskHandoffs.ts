import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";
import { tasksTable } from "./tasks";

export const taskHandoffsTable = pgTable("task_handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  fromActorId: text("from_actor_id").references(() => actorsTable.id),
  toActorId: text("to_actor_id")
    .notNull()
    .references(() => actorsTable.id),
  handoffAt: timestamp("handoff_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
  contextSnapshot: jsonb("context_snapshot").notNull(),
});

export const insertTaskHandoffSchema = createInsertSchema(taskHandoffsTable).omit({
  id: true,
  handoffAt: true,
});
export type InsertTaskHandoff = z.infer<typeof insertTaskHandoffSchema>;
export type TaskHandoff = typeof taskHandoffsTable.$inferSelect;
