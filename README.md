# About

This tool generates sql migrations from declarative schemas written in custom DDL-language.

Columns are not-null by default. Add `?` after the type to make a column nullable:

```ddl
table users {
  id uuid primary key
  email text unique
  display_name text?
}
```

## Supported Targets

- [ ] PostgeSQL
- [ ] SQLite
- [ ] MySql
