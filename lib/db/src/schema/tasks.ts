import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { actorsTable } from "./actors";

export const taskStatusEnum = pgEnum("task_status", [
  "pending_acceptance",
  "accepted",
  "in_progress",
  "completed",
  "transitioned",
  "expired",
]);

export const tasksTable = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  injectedBy: text("injected_by")
    .notNull()
    .references(() => actorsTable.id),
  authorityScope: text("authority_scope"),
  status: taskStatusEnum("status").notNull().default("pending_acceptance"),
  // The actor who currently holds accepted ownership of this task right now,
  // if anyone. Distinct from "has this task ever been accepted" — this is
  // cleared back to null on every handoff, and only set again when the new
  // owner explicitly calls accept_task. task_acceptances remains an
  // append-only historical log of every acceptance event, independent of
  // this pointer to the current live owner.
  currentOwnerActorId: text("current_owner_actor_id").references(() => actorsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({
  id: true,
  status: true,
  currentOwnerActorId: true,
  createdAt: true,
});
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
