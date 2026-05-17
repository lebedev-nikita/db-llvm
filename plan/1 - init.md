# PostgreSQL v0.1 MVP Plan

## Summary

Build the first usable compiler slice: a PostgreSQL-first schema tool that parses
PostgreSQL schema SQL, normalizes it into a stable IR, diffs old/new schema
snapshots, and generates PostgreSQL migration output.

The first version should stay intentionally narrow: tables, columns, primary
keys, unique constraints, indexes, foreign keys, defaults, nullable/not-null,
JSON snapshots, and safe/unsafe migration operation classification.

## Key Changes

- Keep the small module layout:
  - schema.ts: public IR types for Schema, Table, Column, constraints, indexes,
    foreign keys, defaults, and snapshots.
  - parser.ts: PostgreSQL schema SQL parser for the MVP subset.
  - normalize.ts: deterministic ordering and validation of parsed schemas.
  - diff.ts: compare old/new normalized schemas and produce migration operations.
  - postgres.ts: generate PostgreSQL SQL from schema or migration operations.
  - index.ts: public exports only.
- Use this PostgreSQL input shape:

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

- Public API should expose:
  - parsePostgresSchema(source: string): Promise\<Schema>
  - normalizeSchema(schema: Schema): NormalizedSchema
  - diffSchemas(oldSchema: NormalizedSchema, newSchema: NormalizedSchema): MigrationPlan
  - generatePostgresCreateSchema(schema: NormalizedSchema): string
  - generatePostgresMigration(plan: MigrationPlan): string
  - serializeSnapshot(schema: NormalizedSchema): string
  - parseSnapshot(json: string): NormalizedSchema
- Migration operation model should include:
  - safe: create table, add nullable column, add index, add unique constraint,
    add foreign key.
  - unsafe: drop table, drop column, change column type, nullable to not-null,
    rename-like changes without explicit rename annotation.
  - unsupported initially: views, triggers, RLS, extensions, enums beyond keeping
    placeholders out of the v0.1 public surface.

## Test Plan

- Parser tests:
  - parse the PostgreSQL example schema.
  - support primary key, unique, not null, default, and references ... on delete cascade.
  - reject malformed table/column SQL with useful errors.
- Normalize/snapshot tests:
  - deterministic ordering of tables, columns, indexes, and constraints.
  - snapshot JSON round-trips without changing the schema.
- Diff tests:
  - create table from empty schema.
  - add nullable column as safe.
  - drop column as unsafe.
  - change column type as unsafe.
  - add foreign key as safe.
  - generate CREATE TABLE.
  - generate primary key, unique, not-null, default, and foreign key SQL.
  - generate index SQL.
  - generate migration SQL grouped with comments for unsafe operations.

## Assumptions

- PostgreSQL is the only provider for v0.1.
- No database introspection in this version; diffs compare snapshots only.
- The first parser only needs the narrow PostgreSQL schema SQL subset used by
  the MVP.
