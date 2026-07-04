import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const actorTypeEnum = pgEnum("actor_type", ["human", "agent"]);

export const actorsTable = pgTable("actors", {
  id: text("id").primaryKey(),
  type: actorTypeEnum("type").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertActorSchema = createInsertSchema(actorsTable).omit({ createdAt: true });
export type InsertActor = z.infer<typeof insertActorSchema>;
export type Actor = typeof actorsTable.$inferSelect;
