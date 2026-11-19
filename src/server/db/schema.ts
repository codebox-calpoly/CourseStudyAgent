import {
  boolean,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { authUsers } from "drizzle-orm/supabase";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

export const membershipRole = pgEnum("membership_role", [
  "student",
  "professor",
]);
export const voteValue = pgEnum("vote_value", ["confirm", "dispute"]);
export const fileKind = pgEnum("file_kind", [
  "lecture_notes",
  "notes",
  "rubric",
  "past_exam",
  "other",
]);
export const signalStance = pgEnum("signal_stance", [
  "on_exam",
  "not_on_exam",
  "info",
]);

export const users = pgTable("users", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
});

export const classes = pgTable("classes", {
  id: id(),
  createdAt: createdAt(),
  course: text("course").notNull(),
  term: text("term").notNull(),
  section: text("section").notNull(),
  professor: text("professor").notNull(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    createdAt: createdAt(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
  },
  (table) => [unique().on(table.userId, table.classId)],
);

export const joinCodes = pgTable("join_codes", {
  id: id(),
  createdAt: createdAt(),
  classId: uuid("class_id")
    .notNull()
    .references(() => classes.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const files = pgTable(
  "files",
  {
    id: id(),
    createdAt: createdAt(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    storagePath: text("storage_path").notNull(),
    kind: fileKind("kind").default("other").notNull(),
    taughtOn: date("taught_on"),
    professorReleased: boolean("professor_released").default(false).notNull(),
  },
  (table) => [unique().on(table.id, table.classId)],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    createdAt: createdAt(),
    fileId: uuid("file_id").notNull(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.fileId, table.classId],
      foreignColumns: [files.id, files.classId],
    }).onDelete("cascade"),
    index("chunks_embedding_hnsw_index").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const signals = pgTable("signals", {
  id: id(),
  createdAt: createdAt(),
  classId: uuid("class_id")
    .notNull()
    .references(() => classes.id, { onDelete: "cascade" }),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  topic: text("topic"),
  stance: signalStance("stance").default("info").notNull(),
  verifiedByProfessor: boolean("verified_by_professor")
    .default(false)
    .notNull(),
});

export const votes = pgTable(
  "votes",
  {
    id: id(),
    createdAt: createdAt(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: voteValue("value").notNull(),
  },
  (table) => [unique().on(table.signalId, table.userId)],
);

export const examReports = pgTable("exam_reports", {
  id: id(),
  createdAt: createdAt(),
  classId: uuid("class_id")
    .notNull()
    .references(() => classes.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  examName: text("exam_name").notNull(),
  topics: text("topics").array().notNull(),
});

export const prerequisites = pgTable(
  "prerequisites",
  {
    id: id(),
    createdAt: createdAt(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    prerequisiteClassId: uuid("prerequisite_class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.classId, table.prerequisiteClassId)],
);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  uploadedFiles: many(files),
  signals: many(signals),
  votes: many(votes),
  examReports: many(examReports),
}));

export const classesRelations = relations(classes, ({ many }) => ({
  memberships: many(memberships),
  joinCodes: many(joinCodes),
  files: many(files),
  chunks: many(chunks),
  signals: many(signals),
  examReports: many(examReports),
  prerequisites: many(prerequisites, { relationName: "classPrerequisites" }),
  requiredBy: many(prerequisites, { relationName: "requiredByClasses" }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  class: one(classes, {
    fields: [memberships.classId],
    references: [classes.id],
  }),
}));

export const joinCodesRelations = relations(joinCodes, ({ one }) => ({
  class: one(classes, {
    fields: [joinCodes.classId],
    references: [classes.id],
  }),
}));

export const filesRelations = relations(files, ({ one, many }) => ({
  class: one(classes, { fields: [files.classId], references: [classes.id] }),
  uploader: one(users, { fields: [files.uploadedBy], references: [users.id] }),
  chunks: many(chunks),
}));

export const chunksRelations = relations(chunks, ({ one }) => ({
  file: one(files, { fields: [chunks.fileId], references: [files.id] }),
  class: one(classes, { fields: [chunks.classId], references: [classes.id] }),
}));

export const signalsRelations = relations(signals, ({ one, many }) => ({
  class: one(classes, { fields: [signals.classId], references: [classes.id] }),
  author: one(users, { fields: [signals.authorId], references: [users.id] }),
  votes: many(votes),
}));

export const votesRelations = relations(votes, ({ one }) => ({
  signal: one(signals, { fields: [votes.signalId], references: [signals.id] }),
  user: one(users, { fields: [votes.userId], references: [users.id] }),
}));

export const examReportsRelations = relations(examReports, ({ one }) => ({
  class: one(classes, {
    fields: [examReports.classId],
    references: [classes.id],
  }),
  user: one(users, { fields: [examReports.userId], references: [users.id] }),
}));

export const prerequisitesRelations = relations(prerequisites, ({ one }) => ({
  class: one(classes, {
    fields: [prerequisites.classId],
    references: [classes.id],
    relationName: "classPrerequisites",
  }),
  prerequisiteClass: one(classes, {
    fields: [prerequisites.prerequisiteClassId],
    references: [classes.id],
    relationName: "requiredByClasses",
  }),
}));
