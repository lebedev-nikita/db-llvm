# Project Context

## Goal

Build a compiler-style toolkit for PostgreSQL schema changes: parse PostgreSQL
schema SQL, normalize it into a stable intermediate representation, diff old/new
snapshots, and generate PostgreSQL migration SQL.

## Core Pipeline

```text
PostgreSQL schema SQL
   ↓
AST
   ↓
normalized IR
   ↓
schema diff
   ↓
migration plan
   ↓
PostgreSQL SQL generator
   ↓
migration files + snapshot
```

The project should start narrow and harden the data model and diff engine before
expanding into introspection, richer PostgreSQL features, or additional
providers.

## MVP Scope

The first useful version targets PostgreSQL schema SQL:

```sql
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
```

The MVP supports:

- `CREATE TABLE`
- columns
- primary keys
- unique constraints
- indexes
- foreign keys
- defaults
- nullable and not-null columns
- schema snapshots
- diff old/new
- PostgreSQL migration generation
- safe/unsafe migration operation classification

Unsupported initially:

- views
- triggers
- RLS
- extensions
- enums
- stored procedures
- introspection
- additional providers

## Public API

The public API should expose:

- `parsePostgresSchema(source: string): Promise<Schema>`
- `normalizeSchema(schema: Schema): NormalizedSchema`
- `diffSchemas(oldSchema: NormalizedSchema, newSchema: NormalizedSchema): MigrationPlan`
- `generatePostgresCreateSchema(schema: NormalizedSchema): string`
- `generatePostgresMigration(plan: MigrationPlan): string`
- `serializeSnapshot(schema: NormalizedSchema): string`
- `parseSnapshot(json: string): NormalizedSchema`

## Schema Diff

The diff engine compares:

```text
old schema snapshot
new schema snapshot
↓
migration plan
```

Example operations:

```text
AddColumn(users, "name", text, nullable=true)
RenameColumn(users, "username", "handle")
DropIndex(...)
ChangeColumnType(...)
```

Not every change can be inferred safely. Rename vs. drop+add often needs an
explicit hint or manual review.

## Safety Model

Safe examples:

- add a nullable column
- add an index
- add a table

Unsafe examples:

- drop a column
- change a type
- make a nullable column not-null
- infer a rename without an explicit hint

Unsafe operations should produce warnings or require explicit annotations in the
migration plan.

## Provider Capabilities

Providers do not support the same features. Keep a capabilities layer:

```ts
type ProviderCapabilities = {
  supportsTransactionalDDL: boolean;
  supportsConcurrentIndexes: boolean;
  supportsEnums: boolean;
  supportsTriggers: boolean;
  supportsGeneratedColumns: boolean;
};
```

## Snapshot Files

After each migration, save the normalized schema:

```json
{
  "version": 12,
  "tables": {
    "users": {
      "columns": []
    }
  }
}
```

New schemas should be compared to the last snapshot first. Database
introspection is useful later, but snapshots are simpler and reproducible for
the first implementation.

## Testing Approach

Test migrations like a compiler:

```text
input old schema
input new schema
expected migration operations
expected SQL
```

Coverage should include:

- parsing the PostgreSQL example schema
- primary key, unique, not null, default, and foreign keys
- malformed or unsupported SQL parser errors
- deterministic normalization and snapshot round-trips
- create table, add column, drop column, type change, add index, and generated SQL
