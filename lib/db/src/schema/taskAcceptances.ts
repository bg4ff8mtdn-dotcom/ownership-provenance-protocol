import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";
import { tasksTable } from "./tasks";

// Append-only historical log of every acceptance event for a task. Unlike
// the old model, this intentionally allows MULTIPLE rows per task over time
// — one per legitimate re-acceptance after a handoff. Concurrency-safe
// enforcement of "only one actor can hold current ownership at a time" now
// lives on tasks.currentOwnerActorId (guarded at the app level via an
// atomic conditional UPDATE), not on a uniqueness constraint here.
export const taskAcceptancesTable = pgTable("task_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => actorsTable.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  contextNote: text("context_note"),
});

export const insertTaskAcceptanceSchema = createInsertSchema(taskAcceptancesTable).omit({
  id: true,
  acceptedAt: true,
});
export type InsertTaskAcceptance = z.infer<typeof insertTaskAcceptanceSchema>;
export type TaskAcceptance = typeof taskAcceptancesTable.$inferSelect;
