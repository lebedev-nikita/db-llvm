import dedent from "dedent-js";
import { expect, test } from "vitest";

import {
  ParseError,
  diffSchemas,
  generatePostgresCreateSchema,
  generatePostgresMigration,
  normalizeSchema,
  parseSchema,
  parseSnapshot,
  serializeSnapshot,
} from "../src/index.js";

const source = dedent`
  table users {
    id uuid primary key
    email text unique not null
    created_at timestamp default now()
  }

  table posts {
    id uuid primary key
    author_id uuid references users.id on delete cascade
    title text not null
    body text
  }

  index posts_author_id on posts(author_id)
`;

test("parses the MVP schema syntax", () => {
  const schema = parseSchema(source);

  expect(schema.tables).toHaveLength(2);
  expect(schema.indexes).toHaveLength(1);

  const users = schema.tables.find((table) => table.name === "users");
  expect(users).toBeDefined();
  expect(users?.columns.find((column) => column.name === "id")).toEqual({
    name: "id",
    type: "uuid",
    primaryKey: true,
    unique: false,
    nullable: false,
  });
  expect(users?.columns.find((column) => column.name === "email")).toEqual({
    name: "email",
    type: "text",
    primaryKey: false,
    unique: true,
    nullable: false,
  });

  const posts = schema.tables.find((table) => table.name === "posts");
  expect(posts).toBeDefined();
  expect(posts?.columns.find((column) => column.name === "author_id")?.references).toEqual({
    table: "users",
    column: "id",
    onDelete: "cascade",
  });
});

test("rejects malformed syntax with a parse error", () => {
  expect(() => parseSchema("table users {\n  id\n}")).toThrow(ParseError);
});

test("normalizes and round-trips snapshots deterministically", () => {
  const normalized = normalizeSchema(parseSchema(source));
  const snapshot = serializeSnapshot(normalized);
  const reparsed = parseSnapshot(snapshot);

  expect(reparsed).toEqual(normalized);
  expect(snapshot).toBe(serializeSnapshot(reparsed));
});

test("diffs creates, safe column additions, unsafe drops, unsafe type changes, and indexes", () => {
  const oldSchema = normalizeSchema(
    parseSchema(dedent`
      table users {
        id uuid primary key
        email text not null
        age int
      }
    `),
  );
  const newSchema = normalizeSchema(
    parseSchema(dedent`
      table users {
        id uuid primary key
        email varchar not null
        name text
      }

      table posts {
        id uuid primary key
        author_id uuid references users.id on delete cascade
      }

      index posts_author_id on posts(author_id)
    `),
  );

  const plan = diffSchemas(oldSchema, newSchema);

  expect(
    plan.operations.map((operation) => [operation.kind, operation.safety]),
  ).toEqual([
    ["create_table", "safe"],
    ["change_column", "unsafe"],
    ["add_column", "safe"],
    ["drop_column", "unsafe"],
    ["add_index", "safe"],
  ]);
});

test("adding a non-null column is unsafe", () => {
  const oldSchema = normalizeSchema(parseSchema("table users {\n  id uuid primary key\n}"));
  const newSchema = normalizeSchema(parseSchema("table users {\n  id uuid primary key\n  email text not null\n}"));

  const plan = diffSchemas(oldSchema, newSchema);

  expect(plan.operations[0]?.kind).toBe("add_column");
  expect(plan.operations[0]?.safety).toBe("unsafe");
});

test("generates PostgreSQL create schema SQL", () => {
  const sql = generatePostgresCreateSchema(normalizeSchema(parseSchema(source)));

  expect(sql).toMatch(/CREATE TABLE "users"/);
  expect(sql).toMatch(/"id" uuid PRIMARY KEY/);
  expect(sql).toMatch(/"email" text UNIQUE NOT NULL/);
  expect(sql).toMatch(/"created_at" timestamp DEFAULT now\(\)/);
  expect(sql).toMatch(/REFERENCES "users" \("id"\) ON DELETE CASCADE/);
  expect(sql).toMatch(/CREATE INDEX "posts_author_id" ON "posts" \("author_id"\)/);
});

test("generates PostgreSQL migration SQL with safety comments", () => {
  const oldSchema = normalizeSchema(parseSchema("table users {\n  id uuid primary key\n}"));
  const newSchema = normalizeSchema(parseSchema("table users {\n  id uuid primary key\n  email text\n}"));
  const sql = generatePostgresMigration(diffSchemas(oldSchema, newSchema));

  expect(sql).toMatch(/-- SAFE: add_column/);
  expect(sql).toMatch(/ALTER TABLE "users" ADD COLUMN "email" text/);
});
