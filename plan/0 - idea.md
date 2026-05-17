# Project direction notes

## Goal

Build a compiler-style toolkit for database schemas: parse SQL schema
definitions, normalize them into a stable IR, diff old/new snapshots, and
generate migration SQL for the target database.

## Practical starting point

Start with the data model and diff engine, not broad dialect coverage.

The first useful version should target PostgreSQL schema SQL:

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

The MVP should support:

- `CREATE TABLE`
- columns
- primary keys
- unique constraints
- indexes
- foreign keys
- defaults
- nullable and not-null columns
- simple migrations
- PostgreSQL generation first

## Core pipeline

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
provider SQL generator
   ↓
migration files + snapshot
```

## Schema diff

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

## Safety model

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

## Provider capabilities

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

## Snapshot files

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

## Testing approach

Test migrations like a compiler:

```text
input old schema
input new schema
expected migration operations
expected SQL
```

## MVP

```text
v0.1:
- PostgreSQL schema SQL input
- PostgreSQL output
- tables
- columns
- primary keys
- unique constraints
- indexes
- foreign keys
- defaults
- nullable/not-null
- schema snapshots
- diff old/new
- SQL migration generation
```

Triggers, RLS, views, stored procedures, introspection, and additional providers
should come after the diff model is stable.
