import dedent from "dedent-js";
import { expect, test } from "vitest";

import {
  ParseError,
  diffSchemas,
  generatePostgresCreateSchema,
  generatePostgresMigration,
  normalizeSchema,
  parsePostgresSchema,
  parseSnapshot,
  serializeSnapshot,
} from "../src/index.js";

const source = dedent`
  CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text UNIQUE NOT NULL,
    created_at timestamp NOT NULL DEFAULT now()
  );

  CREATE TABLE posts (
    id uuid PRIMARY KEY,
    author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title text NOT NULL,
    body text
  );

  CREATE INDEX posts_author_id ON posts (author_id);
`;

test("parses the MVP PostgreSQL schema SQL", async () => {
  const schema = await parsePostgresSchema(source);

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
  expect(posts?.columns.find((column) => column.name === "body")).toMatchObject({
    type: "text",
    nullable: true,
  });
});

test("parses supported table constraints", async () => {
  const schema = await parsePostgresSchema(dedent`
    CREATE TABLE users (
      id uuid,
      email text,
      PRIMARY KEY (id),
      UNIQUE (email)
    );

    CREATE TABLE posts (
      author_id uuid,
      FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
    );
  `);

  const users = schema.tables.find((table) => table.name === "users");
  expect(users?.columns.find((column) => column.name === "id")).toMatchObject({
    primaryKey: true,
    nullable: false,
  });
  expect(users?.columns.find((column) => column.name === "email")).toMatchObject({
    unique: true,
    nullable: true,
  });

  const posts = schema.tables.find((table) => table.name === "posts");
  expect(posts?.columns.find((column) => column.name === "author_id")?.references).toEqual({
    table: "users",
    column: "id",
    onDelete: "set null",
  });
});

test.for([
  ["cascade", "cascade"],
  ["restrict", "restrict"],
  ["set null", "set null"],
  ["set default", "set default"],
  ["no action", "no action"],
] as const)("parses on delete %s", async ([sqlAction, expectedAction]) => {
  const schema = await parsePostgresSchema(dedent`
    CREATE TABLE users (
      id uuid PRIMARY KEY
    );

    CREATE TABLE posts (
      author_id uuid REFERENCES users (id) ON DELETE ${sqlAction}
    );
  `);

  expect(schema.tables[1]?.columns[0]?.references?.onDelete).toBe(expectedAction);
});

test("rejects malformed SQL with a parse error", async () => {
  await expect(parsePostgresSchema("CREATE TABLE users (id);")).rejects.toThrow(ParseError);
});

test("rejects unsupported PostgreSQL schema constructs", async () => {
  await expect(
    parsePostgresSchema("CREATE TABLE memberships (user_id uuid, team_id uuid, PRIMARY KEY (user_id, team_id));"),
  ).rejects.toThrow(ParseError);
  await expect(
    parsePostgresSchema("CREATE INDEX users_lower_email ON users (lower(email));"),
  ).rejects.toThrow(ParseError);
});

test("normalizes and round-trips snapshots deterministically", async () => {
  const normalized = normalizeSchema(await parsePostgresSchema(source));
  const snapshot = serializeSnapshot(normalized);
  const reparsed = parseSnapshot(snapshot);

  expect(reparsed).toEqual(normalized);
  expect(snapshot).toBe(serializeSnapshot(reparsed));
});

test("diffs creates, safe column additions, unsafe drops, unsafe type changes, and indexes", async () => {
  const oldSchema = normalizeSchema(
    await parsePostgresSchema(dedent`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        age int NOT NULL
      );
    `),
  );
  const newSchema = normalizeSchema(
    await parsePostgresSchema(dedent`
      CREATE TABLE users (
        id uuid PRIMARY KEY,
        email varchar NOT NULL,
        name text
      );

      CREATE TABLE posts (
        id uuid PRIMARY KEY,
        author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX posts_author_id ON posts (author_id);
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

test("adding a non-null column is unsafe", async () => {
  const oldSchema = normalizeSchema(await parsePostgresSchema("CREATE TABLE users (id uuid PRIMARY KEY);"));
  const newSchema = normalizeSchema(await parsePostgresSchema("CREATE TABLE users (id uuid PRIMARY KEY, email text NOT NULL);"));

  const plan = diffSchemas(oldSchema, newSchema);

  expect(plan.operations[0]?.kind).toBe("add_column");
  expect(plan.operations[0]?.safety).toBe("unsafe");
});

test("generates PostgreSQL create schema SQL", async () => {
  const sql = generatePostgresCreateSchema(normalizeSchema(await parsePostgresSchema(source)));

  expect(sql).toMatch(/CREATE TABLE "users"/);
  expect(sql).toMatch(/"id" uuid PRIMARY KEY/);
  expect(sql).toMatch(/"email" text UNIQUE NOT NULL/);
  expect(sql).toMatch(/"created_at" timestamp NOT NULL DEFAULT now\(\)/);
  expect(sql).toMatch(/REFERENCES "users" \("id"\) ON DELETE CASCADE/);
  expect(sql).toMatch(/CREATE INDEX "posts_author_id" ON "posts" \("author_id"\)/);
});

test("generates PostgreSQL migration SQL with safety comments", async () => {
  const oldSchema = normalizeSchema(await parsePostgresSchema("CREATE TABLE users (id uuid PRIMARY KEY);"));
  const newSchema = normalizeSchema(await parsePostgresSchema("CREATE TABLE users (id uuid PRIMARY KEY, email text);"));
  const sql = generatePostgresMigration(diffSchemas(oldSchema, newSchema));

  expect(sql).toMatch(/-- SAFE: add_column/);
  expect(sql).toMatch(/ALTER TABLE "users" ADD COLUMN "email" text/);
});
