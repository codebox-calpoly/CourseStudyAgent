import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  chunks,
  classes,
  examReports,
  files,
  joinCodes,
  memberships,
  prerequisites,
  signals,
  users,
  votes,
} from "./schema";

const tableColumns = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name);

const foreignKeyTargets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => ({
    name: foreignKey.getName(),
    target: getTableName(foreignKey.reference().foreignTable),
    onDelete: foreignKey.onDelete,
  }));

describe("database schema", () => {
  it("defines every required table with a UUID primary key and creation time", () => {
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
      const id = config.columns.find((column) => column.name === "id");
      const createdAt = config.columns.find(
        (column) => column.name === "created_at",
      );

      expect(id).toMatchObject({
        dataType: "string",
        primary: true,
        notNull: true,
      });
      expect(createdAt).toMatchObject({
        dataType: "date",
        notNull: true,
      });
    }
  });

  it("maps the issue's table columns and constraints", () => {
    expect(tableColumns(users)).toEqual(["id", "created_at", "email"]);
    expect(users.email.isUnique).toBe(true);

    expect(tableColumns(classes)).toEqual([
      "id",
      "created_at",
      "course",
      "term",
      "section",
      "professor",
    ]);
    expect(tableColumns(joinCodes)).toEqual([
      "id",
      "created_at",
      "class_id",
      "code",
      "expires_at",
    ]);
    expect(joinCodes.code.isUnique).toBe(true);
    expect(tableColumns(files)).toEqual([
      "id",
      "created_at",
      "class_id",
      "uploaded_by",
      "name",
      "storage_path",
    ]);
    expect(tableColumns(chunks)).toEqual([
      "id",
      "created_at",
      "file_id",
      "class_id",
      "content",
      "embedding",
    ]);
    expect(chunks.embedding.getSQLType()).toBe("vector(1536)");
    expect(tableColumns(signals)).toEqual([
      "id",
      "created_at",
      "class_id",
      "author_id",
      "content",
    ]);
    expect(tableColumns(examReports)).toEqual([
      "id",
      "created_at",
      "class_id",
      "user_id",
      "exam_name",
      "topics",
    ]);

    expect(
      getTableConfig(memberships).uniqueConstraints[0]?.columns.map(
        (column) => column.name,
      ),
    ).toEqual(["user_id", "class_id"]);
    expect(
      getTableConfig(votes).uniqueConstraints[0]?.columns.map(
        (column) => column.name,
      ),
    ).toEqual(["signal_id", "user_id"]);
    expect(
      getTableConfig(prerequisites).uniqueConstraints[0]?.columns.map(
        (column) => column.name,
      ),
    ).toEqual(["class_id", "prerequisite_class_id"]);
  });

  it("links dependent records with cascading foreign keys", () => {
    expect(foreignKeyTargets(memberships)).toEqual([
      {
        name: "memberships_user_id_users_id_fk",
        target: "users",
        onDelete: "cascade",
      },
      {
        name: "memberships_class_id_classes_id_fk",
        target: "classes",
        onDelete: "cascade",
      },
    ]);
    expect(foreignKeyTargets(joinCodes)).toHaveLength(1);
    expect(foreignKeyTargets(files)).toHaveLength(2);
    expect(foreignKeyTargets(chunks)).toHaveLength(2);
    expect(foreignKeyTargets(signals)).toHaveLength(2);
    expect(foreignKeyTargets(votes)).toHaveLength(2);
    expect(foreignKeyTargets(examReports)).toHaveLength(2);
    expect(foreignKeyTargets(prerequisites)).toEqual([
      {
        name: "prerequisites_class_id_classes_id_fk",
        target: "classes",
        onDelete: "cascade",
      },
      {
        name: "prerequisites_prerequisite_class_id_classes_id_fk",
        target: "classes",
        onDelete: "cascade",
      },
    ]);
  });
});
