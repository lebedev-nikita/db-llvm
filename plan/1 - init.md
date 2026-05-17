# DDL Language v0.1 MVP Plan

## Summary

Build the first usable compiler slice described in docs/init.md: a PostgreSQL-only DDL tool that
parses a small declarative schema language, normalizes it into a stable IR, diffs old/new schema
snapshots, and generates SQL migration output.

The first version should stay intentionally narrow: tables, columns, primary keys, unique
constraints, indexes, foreign keys, defaults, nullable/not-null, JSON snapshots, and safe/unsafe
migration operation classification.

## Key Changes

- Replace the current src/index.ts stub with a small module layout:
  - schema.ts: public IR types for Schema, Table, Column, constraints, indexes, foreign keys,
    defaults, and snapshots.
  - parser.ts: parser for the MVP DSL.
  - normalize.ts: deterministic ordering and validation of parsed schemas.
  - diff.ts: compare old/new normalized schemas and produce migration operations.
  - postgres.ts: generate PostgreSQL SQL from schema or migration operations.
  - index.ts: public exports only.
- Use this MVP DSL shape:

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

- Public API should expose:
  - parseSchema(source: string): Schema
  - normalizeSchema(schema: Schema): NormalizedSchema
  - diffSchemas(oldSchema: NormalizedSchema, newSchema: NormalizedSchema): MigrationPlan
  - generatePostgresCreateSchema(schema: NormalizedSchema): string
  - generatePostgresMigration(plan: MigrationPlan): string
  - serializeSnapshot(schema: NormalizedSchema): string
  - parseSnapshot(json: string): NormalizedSchema
- Migration operation model should include:
  - safe: create table, add nullable column, add index, add unique constraint, add foreign
    key.
  - unsafe: drop table, drop column, change column type, nullable to not-null, rename-like
    changes without explicit rename annotation.
  - unsupported initially: views, triggers, RLS, extensions, enums beyond keeping placeholders
    out of the v0.1 public surface.
- Add package scripts:
  - typecheck: tsc --noEmit
  - test: Node’s built-in test runner against compiled or TSX-loaded tests.

## Test Plan

- Parser tests:
  - parse the example schema from docs/init.md.
  - support primary key, unique, not null, default, and references ... on delete cascade.
  - reject malformed table/column syntax with useful errors.
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
- The parser can be handwritten for now to avoid adding grammar dependencies before the language
  stabilizes.
