# db-llvm

`db-llvm` is an experimental compiler toolkit for PostgreSQL schema changes.

The goal is to be LLVM for database schema changes: parse schemas from SQL
dialects, lower them into a stable intermediate representation, compare that
representation with a previous schema snapshot, and emit migrations for a target
database.

The intended first slice is PostgreSQL-in, PostgreSQL-out:

```text
PostgreSQL schema SQL
  -> parsed schema
  -> normalized intermediate representation
  -> snapshot JSON
  -> schema diff
  -> migration plan
  -> PostgreSQL migration SQL
```

## Status

This project is in research stage. Backwards compatibility is not a goal yet.

Implemented:

- PostgreSQL schema SQL parser for the first MVP subset
- Intermediate representation for tables, columns, indexes, defaults, uniqueness,
  primary keys, and foreign keys
- Deterministic normalization and JSON snapshot serialization
- Snapshot parsing with validation
- Diffing between old and new normalized schemas
- Safe/unsafe migration operation classification
- PostgreSQL `CREATE TABLE`, `CREATE INDEX`, and migration SQL generation

Planned:

- PostgreSQL introspection
- Rename annotations or rename inference
- Views, triggers, enums, extensions, RLS, functions, policies, and generated columns
- CLI and migration file management
- Additional input and output dialects after the PostgreSQL pipeline is stable

## Example Input

PostgreSQL is the reference input dialect.

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  display_name text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE posts (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title text NOT NULL,
  body text
);

CREATE INDEX posts_author_id ON posts (author_id);
CREATE UNIQUE INDEX users_email ON users (email);
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

## Programmatic API

Parse PostgreSQL schema SQL, normalize it, snapshot it, diff it, and generate a
PostgreSQL migration:

```ts
import {
  diffSchemas,
  generatePostgresMigration,
  normalizeSchema,
  parsePostgresSchema,
  parseSnapshot,
  serializeSnapshot,
} from "postgres";

const oldSchema = normalizeSchema(
  await parsePostgresSchema(`
  CREATE TABLE users (
    id uuid PRIMARY KEY
  );
`)
);

const newSchema = normalizeSchema(
  await parsePostgresSchema(`
  CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text
  );
`)
);

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
SQL dialect parser / database introspection
  -> AST
  -> normalized IR
  -> diff engine
  -> migration plan
  -> target provider generator
```

Near-term work should harden the IR and diff model around PostgreSQL before
adding more SQL dialects or providers. Database introspection, richer PostgreSQL
features, and migration file orchestration can be layered on top once the core
model is stable.
