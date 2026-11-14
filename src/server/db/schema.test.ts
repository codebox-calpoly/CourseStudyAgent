import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  chunks,
  classes,
  examReports,
  files,
  joinCodes,
  membershipRole,
  memberships,
  prerequisites,
  signals,
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

  it("enforces the allowed membership roles and vote values in PostgreSQL", () => {
    expect(membershipRole.enumValues).toEqual(["student", "professor"]);
    expect(voteValue.enumValues).toEqual(["confirm", "dispute"]);
    expect(memberships.role.getSQLType()).toBe("membership_role");
    expect(votes.value.getSQLType()).toBe("vote_value");
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

  it("creates the pgvector extension before creating vector columns", () => {
    const migration = readdirSync(join(process.cwd(), "drizzle")).find(
      (file) => file.startsWith("0000_") && file.endsWith(".sql"),
    );

    expect(migration).toBeDefined();
    expect(
      readFileSync(join(process.cwd(), "drizzle", migration!), "utf8"),
    ).toMatch(/^CREATE EXTENSION IF NOT EXISTS vector;/);
  });
});
