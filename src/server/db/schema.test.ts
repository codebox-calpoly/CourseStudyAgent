import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { describe, expect, it } from "vitest";

import {
  chunks,
  classes,
  examReports,
  fileKind,
  files,
  joinCodes,
  membershipRole,
  memberships,
  prerequisites,
  signals,
  signalStance,
  users,
  votes,
  voteValue,
} from "./schema";

const foreignKeyDetails = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      columns: reference.columns.map((column) => column.name),
      target: getTableName(reference.foreignTable),
      targetColumns: reference.foreignColumns.map((column) => column.name),
      onDelete: foreignKey.onDelete,
    };
  });

describe("database schema", () => {
  it("gives every table a UUID primary key and creation timestamp", () => {
    const tables = [
      users,
      classes,
      memberships,
      joinCodes,
      files,
      chunks,
      signals,
      votes,
      examReports,
      prerequisites,
    ];

    for (const table of tables) {
      const config = getTableConfig(table);

      expect(
        config.columns.find((column) => column.name === "id"),
      ).toMatchObject({
        dataType: "string",
        primary: true,
        notNull: true,
      });
      expect(
        config.columns.find((column) => column.name === "created_at"),
      ).toMatchObject({ dataType: "date", notNull: true });
    }
  });

  it("enforces all constrained values with PostgreSQL enums", () => {
    expect(membershipRole.enumValues).toEqual(["student", "professor"]);
    expect(voteValue.enumValues).toEqual(["confirm", "dispute"]);
    expect(fileKind.enumValues).toEqual([
      "lecture_notes",
      "notes",
      "rubric",
      "past_exam",
      "other",
    ]);
    expect(signalStance.enumValues).toEqual(["on_exam", "not_on_exam", "info"]);
  });

  it("preserves the required unique constraints and vector dimension", () => {
    const constraintColumns = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).uniqueConstraints.map((constraint) =>
        constraint.columns.map((column) => column.name),
      );

    expect(constraintColumns(memberships)).toContainEqual([
      "user_id",
      "class_id",
    ]);
    expect(constraintColumns(votes)).toContainEqual(["signal_id", "user_id"]);
    expect(constraintColumns(prerequisites)).toContainEqual([
      "class_id",
      "prerequisite_class_id",
    ]);
    expect(constraintColumns(files)).toContainEqual(["id", "class_id"]);
    expect(chunks.embedding.getSQLType()).toBe("vector(1536)");
  });

  it("prevents chunks from referencing a file in another class", () => {
    expect(foreignKeyDetails(chunks)).toContainEqual({
      columns: ["file_id", "class_id"],
      target: "files",
      targetColumns: ["id", "class_id"],
      onDelete: "cascade",
    });
  });

  it("uses Supabase Auth identities without copying their email addresses", () => {
    const [foreignKey] = getTableConfig(users).foreignKeys;

    expect(foreignKey.reference().foreignTable).toBe(authUsers);
    expect(foreignKey.onDelete).toBe("cascade");
    expect(
      getTableConfig(users).columns.map((column) => column.name),
    ).not.toContain("email");
  });

  it("enables pgvector before creating vector columns", () => {
    const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
    const migrations = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const extensionIndex = migrations.findIndex((migration) =>
      readFileSync(join(migrationsDirectory, migration), "utf8").includes(
        "CREATE EXTENSION IF NOT EXISTS vector;",
      ),
    );
    const vectorTableIndex = migrations.findIndex((migration) =>
      readFileSync(join(migrationsDirectory, migration), "utf8").includes(
        'embedding" vector(1536)',
      ),
    );

    expect(extensionIndex).toBeGreaterThanOrEqual(0);
    expect(vectorTableIndex).toBeGreaterThan(extensionIndex);
  });
});
