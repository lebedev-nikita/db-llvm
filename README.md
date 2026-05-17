# ddl-lang

`ddl-lang` is an experimental compiler toolkit for database schemas.

The long-term goal is to be LLVM for DDL: parse schemas from different SQL
dialects or declarative schema languages, lower them into a stable intermediate
representation, compare that representation with a previous schema snapshot, and
emit migrations for a target database.

The current implementation is the first vertical slice of that pipeline:

```text
DDL source
  -> parsed schema
  -> normalized intermediate representation
  -> snapshot JSON
  -> schema diff
  -> migration plan
  -> PostgreSQL SQL
```

## Status

This project is in research stage. Backwards compatibility is not a goal yet.

Implemented:

- Handwritten parser for a small declarative DDL syntax
- Intermediate representation for tables, columns, indexes, defaults, uniqueness,
  primary keys, and foreign keys
- Deterministic normalization and JSON snapshot serialization
- Snapshot parsing with validation
- Diffing between old and new normalized schemas
- Safe/unsafe migration operation classification
- PostgreSQL `CREATE TABLE`, `CREATE INDEX`, and migration SQL generation

Not implemented yet:

- Parsing existing PostgreSQL, MySQL, SQLite, or other SQL dialect DDL
- Database introspection
- Rename annotations or rename inference
- Views, triggers, enums, extensions, RLS, functions, policies, and generated columns
- CLI and migration file management

## Schema Syntax

Columns are non-null by default. Add `?` after the type to make a column nullable.

```ddl
table users {
  id uuid primary key
  email text unique
  display_name text?
  created_at timestamp default now()
}

table posts {
  id uuid primary key
  author_id uuid references users.id on delete cascade
  title text
  body text?
}

index posts_author_id on posts(author_id)
unique index users_email on users(email)
```

Supported column attributes:

- `primary key`
- `unique`
- `default <value>`
- `references <table>.<column>`
- `references <table>.<column> on delete cascade`
- `references <table>.<column> on delete restrict`
- `references <table>.<column> on delete set null`
- `references <table>.<column> on delete set default`
- `references <table>.<column> on delete no action`

Line comments can use `#` or `//`.

## Public API

```ts
import {
  diffSchemas,
  generatePostgresCreateSchema,
  generatePostgresMigration,
  normalizeSchema,
  parseSchema,
  parseSnapshot,
  serializeSnapshot,
} from "ddl-lang";

const oldSchema = normalizeSchema(parseSchema(`
  table users {
    id uuid primary key
  }
`));

const newSchema = normalizeSchema(parseSchema(`
  table users {
    id uuid primary key
    email text?
  }
`));

const snapshot = serializeSnapshot(newSchema);
const restored = parseSnapshot(snapshot);
const plan = diffSchemas(oldSchema, restored);

console.log(generatePostgresMigration(plan));
```

Generated migration SQL includes operation safety comments:

```sql
-- SAFE: add_column
ALTER TABLE "users" ADD COLUMN "email" text;
```

## Intermediate Representation

The core IR currently looks like this:

```ts
type Schema = {
  readonly tables: Table[];
  readonly indexes: Index[];
};

type Table = {
  readonly name: string;
  readonly columns: Column[];
};

type Column = {
  readonly name: string;
  readonly type: string;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly nullable: boolean;
  readonly default?: string;
  readonly references?: {
    readonly table: string;
    readonly column: string;
    readonly onDelete?: "cascade" | "restrict" | "set null" | "set default" | "no action";
  };
};
```

Normalization sorts tables, columns, and indexes by name, forces primary keys to
be non-null, and validates duplicate names, foreign keys, and index targets.

Snapshots are canonical JSON produced from the normalized IR. Diffs compare
snapshots, not a live database.

## Migration Diffing

`diffSchemas(oldSchema, newSchema)` produces a `MigrationPlan` with operations
such as:

- `create_table`
- `drop_table`
- `add_column`
- `drop_column`
- `change_column`
- `add_index`
- `drop_index`

Current safety classification:

- Safe: creating a table, adding a nullable non-primary-key column, adding an index
- Unsafe: dropping tables or columns, changing columns, dropping indexes, adding a
  non-null column

Constraint changes inside `change_column` are emitted with a manual-review SQL
comment in the PostgreSQL generator.

## PostgreSQL Generation

`generatePostgresCreateSchema(schema)` emits a full PostgreSQL schema:

```sql
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY,
  "email" text UNIQUE NOT NULL
);
```

`generatePostgresMigration(plan)` emits SQL for a diff plan:

```sql
-- SAFE: add_column
ALTER TABLE "users" ADD COLUMN "email" text;
```

The type mapper is intentionally small. It currently maps `string` to `text` and
passes other type names through unchanged.

## Development

Install dependencies:

```sh
pnpm install
```

Run checks:

```sh
just typecheck
just test
```

The repo uses `justfile` for development commands.

## Direction

The intended architecture is provider-agnostic:

```text
source parser / dialect importer
  -> AST
  -> normalized IR
  -> diff engine
  -> migration plan
  -> target provider generator
```

Near-term work should keep hardening the IR and diff model before adding more
syntax or providers. Multi-dialect SQL import, database introspection, richer
PostgreSQL features, and migration file orchestration can be layered on top once
the core model is stable.
