import { expect, test } from "vitest";

import {
  normalizeSchema,
  parseSnapshot,
  SchemaValidationError,
  serializeSnapshot,
} from "../src/index.js";
import type { Column, Schema } from "../src/index.js";

test("normalizes the intermediate representation deterministically", () => {
  const schema: Schema = {
    tables: [
      {
        name: "users",
        columns: [
          {
            name: "email",
            type: "text",
            primaryKey: false,
            unique: true,
            nullable: false,
            default: "lower(raw_email)",
          },
          {
            name: "id",
            type: "uuid",
            primaryKey: true,
            unique: false,
            nullable: true,
          },
        ],
      },
      {
        name: "posts",
        columns: [
          {
            name: "title",
            type: "text",
            primaryKey: false,
            unique: false,
            nullable: false,
          },
          {
            name: "author_id",
            type: "uuid",
            primaryKey: false,
            unique: false,
            nullable: false,
            references: { table: "users", column: "id" },
          },
        ],
      },
    ],
    indexes: [
      {
        name: "users_email",
        table: "users",
        columns: ["email"],
        unique: true,
      },
      {
        name: "posts_author_title",
        table: "posts",
        columns: ["author_id", "title"],
        unique: false,
      },
    ],
  };

  expect(normalizeSchema(schema)).toEqual({
    tables: [
      {
        name: "posts",
        columns: [
          {
            name: "author_id",
            type: "uuid",
            primaryKey: false,
            unique: false,
            nullable: false,
            references: { table: "users", column: "id" },
          },
          {
            name: "title",
            type: "text",
            primaryKey: false,
            unique: false,
            nullable: false,
          },
        ],
      },
      {
        name: "users",
        columns: [
          {
            name: "email",
            type: "text",
            primaryKey: false,
            unique: true,
            nullable: false,
            default: "lower(raw_email)",
          },
          {
            name: "id",
            type: "uuid",
            primaryKey: true,
            unique: false,
            nullable: false,
          },
        ],
      },
    ],
    indexes: [
      {
        name: "posts_author_title",
        table: "posts",
        columns: ["author_id", "title"],
        unique: false,
      },
      {
        name: "users_email",
        table: "users",
        columns: ["email"],
        unique: true,
      },
    ],
  });
});

test("preserves foreign key on delete actions in the intermediate representation", () => {
  const normalized = normalizeSchema({
    tables: [
      {
        name: "users",
        columns: [
          {
            name: "id",
            type: "uuid",
            primaryKey: true,
            unique: false,
            nullable: false,
          },
        ],
      },
      {
        name: "posts",
        columns: [
          {
            name: "author_id",
            type: "uuid",
            primaryKey: false,
            unique: false,
            nullable: true,
            references: { table: "users", column: "id", onDelete: "set null" },
          },
        ],
      },
    ],
    indexes: [],
  });

  expect(normalized.tables[0]?.columns[0]?.references).toEqual({
    table: "users",
    column: "id",
    onDelete: "set null",
  });
});

test("serializes and parses snapshots as canonical intermediate representation JSON", () => {
  const snapshot = serializeSnapshot({
    tables: [
      {
        name: "users",
        columns: [
          {
            name: "id",
            type: "uuid",
            primaryKey: true,
            unique: false,
            nullable: true,
          },
        ],
      },
    ],
    indexes: [],
  });

  expect(snapshot.endsWith("\n")).toBe(true);
  expect(snapshot).toBe(`{
  "tables": [
    {
      "name": "users",
      "columns": [
        {
          "name": "id",
          "type": "uuid",
          "primaryKey": true,
          "unique": false,
          "nullable": false
        }
      ]
    }
  ],
  "indexes": []
}
`);
  expect(parseSnapshot(snapshot)).toEqual(JSON.parse(snapshot));
});

test("parses snapshots by re-normalizing valid unsorted JSON", () => {
  const reparsed = parseSnapshot(`{
    "tables": [
      {
        "name": "users",
        "columns": [
          {
            "name": "email",
            "type": "text",
            "primaryKey": false,
            "unique": false,
            "nullable": false
          },
          {
            "name": "id",
            "type": "uuid",
            "primaryKey": true,
            "unique": false,
            "nullable": true
          }
        ]
      }
    ],
    "indexes": []
  }`);

  expect(reparsed.tables[0]?.columns.map((column) => column.name)).toEqual(["email", "id"]);
  expect(reparsed.tables[0]?.columns.find((column) => column.name === "id")?.nullable).toBe(false);
});

test.for<{ name: string; schema: Schema; message: string }>([
  {
    name: "duplicate table names",
    schema: {
      tables: [
        { name: "users", columns: [] },
        { name: "users", columns: [] },
      ],
      indexes: [],
    },
    message: 'duplicate table "users"',
  },
  {
    name: "duplicate columns",
    schema: {
      tables: [
        {
          name: "users",
          columns: [column("email", "text"), column("email", "varchar")],
        },
      ],
      indexes: [],
    },
    message: 'duplicate column "users.email"',
  },
  {
    name: "foreign key to missing table",
    schema: {
      tables: [
        {
          name: "posts",
          columns: [
            {
              ...column("author_id", "uuid"),
              references: { table: "users", column: "id" },
            },
          ],
        },
      ],
      indexes: [],
    },
    message: 'column "posts.author_id" references missing table "users"',
  },
  {
    name: "foreign key to missing column",
    schema: {
      tables: [
        { name: "users", columns: [column("id", "uuid")] },
        {
          name: "posts",
          columns: [
            {
              ...column("author_id", "uuid"),
              references: { table: "users", column: "missing_id" },
            },
          ],
        },
      ],
      indexes: [],
    },
    message: 'column "posts.author_id" references missing column "users.missing_id"',
  },
  {
    name: "duplicate index names",
    schema: {
      tables: [{ name: "users", columns: [column("email", "text")] }],
      indexes: [
        { name: "users_email", table: "users", columns: ["email"], unique: false },
        { name: "users_email", table: "users", columns: ["email"], unique: true },
      ],
    },
    message: 'duplicate index "users_email"',
  },
  {
    name: "index targeting missing table",
    schema: {
      tables: [],
      indexes: [{ name: "users_email", table: "users", columns: ["email"], unique: false }],
    },
    message: 'index "users_email" targets missing table "users"',
  },
  {
    name: "index targeting missing column",
    schema: {
      tables: [{ name: "users", columns: [column("id", "uuid")] }],
      indexes: [{ name: "users_email", table: "users", columns: ["email"], unique: false }],
    },
    message: 'index "users_email" targets missing column "users.email"',
  },
])("rejects invalid intermediate representation: $name", ({ schema, message }) => {
  expect(() => normalizeSchema(schema)).toThrow(SchemaValidationError);
  expect(() => normalizeSchema(schema)).toThrow(message);
});

test("rejects invalid snapshot root shape", () => {
  expect(() => parseSnapshot(`{"tables": {}}`)).toThrow(SchemaValidationError);
  expect(() => parseSnapshot(`{"tables": {}}`)).toThrow(
    "snapshot must contain tables and indexes arrays"
  );
});

function column(name: string, type: string): Column {
  return { name, type, primaryKey: false, unique: false, nullable: false };
}
