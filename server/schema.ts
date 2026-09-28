import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const labs = pgTable("labs", {
  id: uuid("id").primaryKey(),
  scenario: text("scenario").notNull(),
  seed: integer("seed").notNull().default(1),
  counter: integer("counter").notNull().default(0),
  running: boolean("running").notNull().default(false),
  rate: integer("rate").notNull().default(1),
  eventTypes: jsonb("event_types").$type<string[]>().notNull(),
  featureEnabled: boolean("feature_enabled").notNull(),
  release: text("release").notNull(),
  upstreamHealthy: boolean("upstream_healthy").notNull(),
  failNextAction: boolean("fail_next_action").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  type: text("type").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eventPlans = pgTable("event_plans", {
  id: uuid("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  total: integer("total").notNull(),
  sent: integer("sent").notNull().default(0),
  intervalMs: integer("interval_ms").notNull(),
  weights: jsonb("weights").$type<Record<string, number>>().notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const observations = pgTable("observations", {
  id: uuid("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  healthy: boolean("healthy").notNull(),
  errorRate: integer("error_rate").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actions = pgTable("actions", {
  id: text("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  name: text("name").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  goal: text("goal").notNull(),
  status: text("status").notNull(),
  iteration: integer("iteration").notNull().default(0),
  waitReason: text("wait_reason"),
  report: text("report"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  runId: uuid("run_id").notNull().references(() => runs.id),
  actionId: text("action_id").notNull(),
  action: text("action").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timeline = pgTable("timeline", {
  id: uuid("id").primaryKey(),
  labId: uuid("lab_id").notNull().references(() => labs.id),
  runId: uuid("run_id").references(() => runs.id),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
