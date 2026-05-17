import type { Column, Index, NormalizedSchema, Schema, Table } from "./schema.js";

export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaValidationError";
  }
}

export function normalizeSchema(schema: Schema): NormalizedSchema {
  const tables = [...schema.tables].sort(byName).map(normalizeTable);
  const indexes = [...schema.indexes].sort(byName).map(normalizeIndex);
  validateSchema({ tables, indexes });
  return { tables, indexes };
}

export function serializeSnapshot(schema: NormalizedSchema): string {
  return `${JSON.stringify(normalizeSchema(schema), null, 2)}\n`;
}

export function parseSnapshot(json: string): NormalizedSchema {
  const value: unknown = JSON.parse(json);
  assertSchemaShape(value);
  return normalizeSchema(value);
}

function normalizeTable(table: Table): Table {
  return {
    name: table.name,
    columns: [...table.columns].sort(byName).map(normalizeColumn),
  };
}

function normalizeColumn(column: Column): Column {
  return {
    name: column.name,
    type: column.type,
    primaryKey: column.primaryKey,
    unique: column.unique,
    nullable: column.primaryKey ? false : column.nullable,
    ...(column.default === undefined ? {} : { default: column.default }),
    ...(column.references === undefined
      ? {}
      : {
          references: {
            table: column.references.table,
            column: column.references.column,
            ...(column.references.onDelete === undefined ? {} : { onDelete: column.references.onDelete }),
          },
        }),
  };
}

function normalizeIndex(index: Index): Index {
  return {
    name: index.name,
    table: index.table,
    columns: [...index.columns],
    unique: index.unique,
  };
}

function validateSchema(schema: NormalizedSchema): void {
  const tableNames = new Set<string>();
  const indexNames = new Set<string>();

  for (const table of schema.tables) {
    if (tableNames.has(table.name)) {
      throw new SchemaValidationError(`duplicate table "${table.name}"`);
    }
    tableNames.add(table.name);

    const columnNames = new Set<string>();
    for (const column of table.columns) {
      if (columnNames.has(column.name)) {
        throw new SchemaValidationError(`duplicate column "${table.name}.${column.name}"`);
      }
      columnNames.add(column.name);
    }
  }

  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (!column.references) {
        continue;
      }
      const targetTable = schema.tables.find((candidate) => candidate.name === column.references?.table);
      if (!targetTable) {
        throw new SchemaValidationError(
          `column "${table.name}.${column.name}" references missing table "${column.references.table}"`,
        );
      }
      if (!targetTable.columns.some((candidate) => candidate.name === column.references?.column)) {
        throw new SchemaValidationError(
          `column "${table.name}.${column.name}" references missing column "${column.references.table}.${column.references.column}"`,
        );
      }
    }
  }

  for (const index of schema.indexes) {
    if (indexNames.has(index.name)) {
      throw new SchemaValidationError(`duplicate index "${index.name}"`);
    }
    indexNames.add(index.name);

    const table = schema.tables.find((candidate) => candidate.name === index.table);
    if (!table) {
      throw new SchemaValidationError(`index "${index.name}" targets missing table "${index.table}"`);
    }

    for (const column of index.columns) {
      if (!table.columns.some((candidate) => candidate.name === column)) {
        throw new SchemaValidationError(`index "${index.name}" targets missing column "${index.table}.${column}"`);
      }
    }
  }
}

function assertSchemaShape(value: unknown): asserts value is Schema {
  if (!isRecord(value) || !Array.isArray(value.tables) || !Array.isArray(value.indexes)) {
    throw new SchemaValidationError("snapshot must contain tables and indexes arrays");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name.localeCompare(right.name);
}
