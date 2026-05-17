import type { Column, ColumnChange, MigrationOperation, MigrationPlan, NormalizedSchema, Table } from "./schema.js";

export function diffSchemas(oldSchema: NormalizedSchema, newSchema: NormalizedSchema): MigrationPlan {
  const operations: MigrationOperation[] = [];
  const oldTables = new Map(oldSchema.tables.map((table) => [table.name, table]));
  const newTables = new Map(newSchema.tables.map((table) => [table.name, table]));
  const oldIndexes = new Map(oldSchema.indexes.map((index) => [index.name, index]));
  const newIndexes = new Map(newSchema.indexes.map((index) => [index.name, index]));

  for (const table of newSchema.tables) {
    const oldTable = oldTables.get(table.name);
    if (!oldTable) {
      operations.push({ kind: "create_table", safety: "safe", table });
      continue;
    }

    operations.push(...diffColumns(oldTable, table));
  }

  for (const table of oldSchema.tables) {
    if (!newTables.has(table.name)) {
      operations.push({ kind: "drop_table", safety: "unsafe", table });
    }
  }

  for (const index of newSchema.indexes) {
    if (!oldIndexes.has(index.name)) {
      operations.push({ kind: "add_index", safety: "safe", index });
    }
  }

  for (const index of oldSchema.indexes) {
    const newIndex = newIndexes.get(index.name);
    if (!newIndex || JSON.stringify(newIndex) !== JSON.stringify(index)) {
      operations.push({ kind: "drop_index", safety: "unsafe", index });
    }
  }

  return { operations };
}

function diffColumns(oldTable: Table, newTable: Table): MigrationOperation[] {
  const operations: MigrationOperation[] = [];
  const oldColumns = new Map(oldTable.columns.map((column) => [column.name, column]));
  const newColumns = new Map(newTable.columns.map((column) => [column.name, column]));

  for (const column of newTable.columns) {
    const oldColumn = oldColumns.get(column.name);
    if (!oldColumn) {
      operations.push({
        kind: "add_column",
        safety: column.nullable && !column.primaryKey ? "safe" : "unsafe",
        tableName: newTable.name,
        column,
      });
      continue;
    }

    const changes = getColumnChanges(oldColumn, column);
    if (changes.length > 0) {
      operations.push({
        kind: "change_column",
        safety: "unsafe",
        tableName: newTable.name,
        before: oldColumn,
        after: column,
        changes,
      });
    }
  }

  for (const column of oldTable.columns) {
    if (!newColumns.has(column.name)) {
      operations.push({ kind: "drop_column", safety: "unsafe", tableName: oldTable.name, column });
    }
  }

  return operations;
}

function getColumnChanges(before: Column, after: Column): ColumnChange[] {
  const changes: ColumnChange[] = [];
  if (before.type !== after.type) changes.push("type");
  if (before.nullable !== after.nullable) changes.push("nullable");
  if (before.default !== after.default) changes.push("default");
  if (before.primaryKey !== after.primaryKey) changes.push("primary_key");
  if (before.unique !== after.unique) changes.push("unique");
  if (JSON.stringify(before.references) !== JSON.stringify(after.references)) changes.push("references");
  return changes;
}
