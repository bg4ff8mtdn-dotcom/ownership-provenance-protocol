import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";
import { tasksTable } from "./tasks";

export const provenanceEnum = pgEnum("provenance", ["observed", "reviewed", "reported"]);

export const taskCompletionsTable = pgTable("task_completions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => actorsTable.id),
  provenance: provenanceEnum("provenance").notNull(),
  claimText: text("claim_text").notNull(),
  sourceReference: text("source_reference"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskCompletionSchema = createInsertSchema(taskCompletionsTable).omit({
  id: true,
  reportedAt: true,
});
export type InsertTaskCompletion = z.infer<typeof insertTaskCompletionSchema>;
export type TaskCompletion = typeof taskCompletionsTable.$inferSelect;
