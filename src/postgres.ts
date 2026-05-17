import type { Column, Index, MigrationOperation, MigrationPlan, NormalizedSchema, Table } from "./schema.js";

export function generatePostgresCreateSchema(schema: NormalizedSchema): string {
  const statements = [
    ...schema.tables.map(createTableSql),
    ...schema.indexes.map(createIndexSql),
  ];
  return joinStatements(statements);
}

export function generatePostgresMigration(plan: MigrationPlan): string {
  return joinStatements(plan.operations.map(operationSql));
}

function operationSql(operation: MigrationOperation): string {
  const safetyComment = `-- ${operation.safety.toUpperCase()}: ${operation.kind}`;

  switch (operation.kind) {
    case "create_table":
      return `${safetyComment}\n${createTableSql(operation.table)}`;
    case "drop_table":
      return `${safetyComment}\nDROP TABLE ${quoteIdent(operation.table.name)}`;
    case "add_column":
      return `${safetyComment}\nALTER TABLE ${quoteIdent(operation.tableName)} ADD COLUMN ${columnSql(operation.column)}`;
    case "drop_column":
      return `${safetyComment}\nALTER TABLE ${quoteIdent(operation.tableName)} DROP COLUMN ${quoteIdent(operation.column.name)}`;
    case "change_column":
      return `${safetyComment}\n${changeColumnSql(operation)}`;
    case "add_index":
      return `${safetyComment}\n${createIndexSql(operation.index)}`;
    case "drop_index":
      return `${safetyComment}\nDROP INDEX ${quoteIdent(operation.index.name)}`;
  }
}

function createTableSql(table: Table): string {
  const lines = table.columns.map((column) => `  ${columnSql(column)}`);
  return `CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(",\n")}\n)`;
}

function columnSql(column: Column): string {
  const parts = [quoteIdent(column.name), postgresType(column.type)];

  if (column.primaryKey) {
    parts.push("PRIMARY KEY");
  }

  if (column.unique) {
    parts.push("UNIQUE");
  }

  if (!column.nullable && !column.primaryKey) {
    parts.push("NOT NULL");
  }

  if (column.default !== undefined) {
    parts.push("DEFAULT", column.default);
  }

  if (column.references) {
    parts.push(
      "REFERENCES",
      `${quoteIdent(column.references.table)} (${quoteIdent(column.references.column)})`,
    );
    if (column.references.onDelete) {
      parts.push("ON DELETE", column.references.onDelete.toUpperCase());
    }
  }

  return parts.join(" ");
}

function createIndexSql(index: Index): string {
  const unique = index.unique ? "UNIQUE " : "";
  const columns = index.columns.map(quoteIdent).join(", ");
  return `CREATE ${unique}INDEX ${quoteIdent(index.name)} ON ${quoteIdent(index.table)} (${columns})`;
}

function changeColumnSql(operation: Extract<MigrationOperation, { readonly kind: "change_column" }>): string {
  const statements: string[] = [];
  const table = quoteIdent(operation.tableName);
  const column = quoteIdent(operation.after.name);

  if (operation.changes.includes("type")) {
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} TYPE ${postgresType(operation.after.type)}`);
  }
  if (operation.changes.includes("nullable")) {
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${operation.after.nullable ? "DROP" : "SET"} NOT NULL`);
  }
  if (operation.changes.includes("default")) {
    const clause = operation.after.default === undefined ? "DROP DEFAULT" : `SET DEFAULT ${operation.after.default}`;
    statements.push(`ALTER TABLE ${table} ALTER COLUMN ${column} ${clause}`);
  }
  if (operation.changes.some((change) => change === "primary_key" || change === "unique" || change === "references")) {
    statements.push(`-- Manual review required for constraint changes on ${operation.tableName}.${operation.after.name}`);
  }

  return statements.join(";\n");
}

function postgresType(type: string): string {
  if (type === "string") {
    return "text";
  }
  return type;
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function joinStatements(statements: readonly string[]): string {
  if (statements.length === 0) {
    return "";
  }
  return `${statements.join(";\n\n")};\n`;
}
