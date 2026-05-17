import { deparse, parse } from "pgsql-parser";

import type { ForeignKeyAction, ForeignKeyReference, Index, Schema, Table } from "./schema.js";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = "ParseError";
  }
}

export async function parsePostgresSchema(source: string): Promise<Schema> {
  let ast: unknown;
  try {
    ast = await parse(source);
  } catch (error) {
    throw new ParseError(getSqlErrorMessage(error), getSqlErrorLine(error, source));
  }

  const root = asRecord(ast, "parser result");
  const statements = asArray(root.stmts, "parser result statements");
  const tables: Table[] = [];
  const indexes: Index[] = [];

  for (const statement of statements) {
    const stmt = asRecord(asRecord(statement, "statement").stmt, "statement body");

    if (isRecord(stmt.CreateStmt)) {
      tables.push(await parseCreateTable(stmt.CreateStmt, source));
      continue;
    }

    if (isRecord(stmt.IndexStmt)) {
      indexes.push(parseCreateIndex(stmt.IndexStmt, source));
      continue;
    }

    throw parseError("unsupported PostgreSQL statement; expected CREATE TABLE or CREATE INDEX", source, locationOf(stmt));
  }

  return { tables, indexes };
}

async function parseCreateTable(node: Record<string, unknown>, source: string): Promise<Table> {
  const relation = parseRelation(node.relation, source);
  if (
    node.inhRelations !== undefined ||
    node.partbound !== undefined ||
    node.partspec !== undefined ||
    node.ofTypename !== undefined ||
    node.tablespacename !== undefined ||
    node.if_not_exists === true
  ) {
    throw parseError(`unsupported CREATE TABLE option on "${relation.name}"`, source, locationOf(node));
  }

  const columns: MutableColumn[] = [];
  const tableConstraints: Record<string, unknown>[] = [];

  for (const element of asArray(node.tableElts, `table "${relation.name}" elements`)) {
    const record = asRecord(element, `table "${relation.name}" element`);
    if (isRecord(record.ColumnDef)) {
      columns.push(await parseColumn(record.ColumnDef, source));
      continue;
    }
    if (isRecord(record.Constraint)) {
      tableConstraints.push(record.Constraint);
      continue;
    }
    throw parseError(`unsupported table element in "${relation.name}"`, source, locationOf(record));
  }

  for (const constraint of tableConstraints) {
    applyTableConstraint(relation.name, columns, constraint, source);
  }

  return {
    name: relation.name,
    columns: columns.map((column) => ({
      name: column.name,
      type: column.type,
      primaryKey: column.primaryKey,
      unique: column.unique,
      nullable: column.primaryKey ? false : column.nullable,
      ...(column.default === undefined ? {} : { default: column.default }),
      ...(column.references === undefined ? {} : { references: column.references }),
    })),
  };
}

async function parseColumn(node: Record<string, unknown>, source: string): Promise<MutableColumn> {
  const column: MutableColumn = {
    name: expectString(node.colname, "column name", source, locationOf(node)),
    type: parseTypeName(node.typeName, source),
    primaryKey: false,
    unique: false,
    nullable: true,
  };

  for (const wrapper of asOptionalArray(node.constraints)) {
    const constraint = asRecord(asRecord(wrapper, "column constraint").Constraint, "column constraint body");
    await applyColumnConstraint(column, constraint, source);
  }

  return column;
}

async function applyColumnConstraint(
  column: MutableColumn,
  constraint: Record<string, unknown>,
  source: string,
): Promise<void> {
  switch (expectString(constraint.contype, "column constraint type", source, locationOf(constraint))) {
    case "CONSTR_PRIMARY":
      column.primaryKey = true;
      column.nullable = false;
      return;
    case "CONSTR_UNIQUE":
      column.unique = true;
      return;
    case "CONSTR_NOTNULL":
      column.nullable = false;
      return;
    case "CONSTR_NULL":
      column.nullable = true;
      return;
    case "CONSTR_DEFAULT":
      column.default = await deparseDefaultExpression(constraint.raw_expr, source);
      return;
    case "CONSTR_FOREIGN":
      column.references = parseForeignKeyReference(constraint, source);
      return;
    default:
      throw parseError(`unsupported column constraint on "${column.name}"`, source, locationOf(constraint));
  }
}

function applyTableConstraint(
  tableName: string,
  columns: MutableColumn[],
  constraint: Record<string, unknown>,
  source: string,
): void {
  const type = expectString(constraint.contype, "table constraint type", source, locationOf(constraint));

  if (type === "CONSTR_PRIMARY" || type === "CONSTR_UNIQUE") {
    const columnName = singleConstraintColumn(constraint.keys, type, source, locationOf(constraint));
    const column = findColumn(tableName, columns, columnName, source, locationOf(constraint));
    if (type === "CONSTR_PRIMARY") {
      column.primaryKey = true;
      column.nullable = false;
    } else {
      column.unique = true;
    }
    return;
  }

  if (type === "CONSTR_FOREIGN") {
    const columnName = singleConstraintColumn(constraint.fk_attrs, type, source, locationOf(constraint));
    const column = findColumn(tableName, columns, columnName, source, locationOf(constraint));
    column.references = parseForeignKeyReference(constraint, source);
    return;
  }

  throw parseError(`unsupported table constraint in "${tableName}"`, source, locationOf(constraint));
}

function parseCreateIndex(node: Record<string, unknown>, source: string): Index {
  const relation = parseRelation(node.relation, source);
  const method = node.accessMethod === undefined ? "btree" : expectString(node.accessMethod, "index method", source, locationOf(node));
  if (method !== "btree") {
    throw parseError(`unsupported index method "${method}"`, source, locationOf(node));
  }

  if (
    node.whereClause !== undefined ||
    node.indexIncludingParams !== undefined ||
    node.options !== undefined ||
    node.concurrent === true ||
    node.if_not_exists === true ||
    node.nulls_not_distinct === true
  ) {
    throw parseError("unsupported index options", source, locationOf(node));
  }

  const columns = asArray(node.indexParams, "index columns").map((element) => {
    const indexElement = asRecord(asRecord(element, "index element").IndexElem, "index element body");
    if (indexElement.expr !== undefined || indexElement.collation !== undefined || indexElement.opclass !== undefined) {
      throw parseError("unsupported index expression or option", source, locationOf(indexElement));
    }
    return expectString(indexElement.name, "index column name", source, locationOf(indexElement));
  });

  if (columns.length === 0) {
    throw parseError("index requires at least one column", source, locationOf(node));
  }

  return {
    name: expectString(node.idxname, "index name", source, locationOf(node)),
    table: relation.name,
    columns,
    unique: node.unique === true,
  };
}

function parseRelation(value: unknown, source: string): { readonly name: string } {
  const relation = asRecord(value, "relation");
  if (relation.schemaname !== undefined) {
    throw parseError("schema-qualified names are not supported yet", source, locationOf(relation));
  }
  if (relation.relpersistence !== undefined && relation.relpersistence !== "p") {
    throw parseError("temporary and unlogged relations are not supported yet", source, locationOf(relation));
  }
  return {
    name: expectString(relation.relname, "relation name", source, locationOf(relation)),
  };
}

function parseTypeName(value: unknown, source: string): string {
  const typeName = asRecord(value, "type name");
  const names = asArray(typeName.names, "type name parts")
    .map((part) => expectString(asRecord(asRecord(part, "type name part").String, "type name string").sval, "type name", source, locationOf(typeName)))
    .filter((part) => part !== "pg_catalog");

  if (names.length === 0 || names.length > 1) {
    throw parseError("schema-qualified type names are not supported yet", source, locationOf(typeName));
  }

  const typmods = asOptionalArray(typeName.typmods).map((typmod) => literalValue(typmod, source));
  return typmods.length === 0 ? names[0]! : `${names[0]!}(${typmods.join(", ")})`;
}

function parseForeignKeyReference(constraint: Record<string, unknown>, source: string): ForeignKeyReference {
  const table = parseRelation(constraint.pktable, source).name;
  const column = singleConstraintColumn(constraint.pk_attrs, "CONSTR_FOREIGN", source, locationOf(constraint));
  const onDelete = parseForeignKeyAction(constraint.fk_del_action, constraint, source);
  return {
    table,
    column,
    ...(onDelete === undefined ? {} : { onDelete }),
  };
}

function parseForeignKeyAction(
  value: unknown,
  constraint: Record<string, unknown>,
  source: string,
): ForeignKeyAction | undefined {
  switch (value) {
    case undefined:
    case "a":
      if (/\bon\s+delete\s+no\s+action\b/i.test(source.slice(locationOf(constraint), locationOf(constraint) + 200))) {
        return "no action";
      }
      return undefined;
    case "c":
      return "cascade";
    case "r":
      return "restrict";
    case "n":
      return "set null";
    case "d":
      return "set default";
    default:
      return undefined;
  }
}

async function deparseDefaultExpression(expression: unknown, source: string): Promise<string> {
  if (expression === undefined) {
    throw parseError("default requires an expression", source, 0);
  }

  const sql = await deparse({
    stmts: [
      {
        stmt: {
          SelectStmt: {
            targetList: [
              {
                ResTarget: {
                  val: expression,
                },
              },
            ],
            op: "SETOP_NONE",
          },
        },
      },
    ],
  } as never);

  return sql.replace(/^SELECT\s+/i, "").replace(/;$/, "");
}

function singleConstraintColumn(value: unknown, constraintType: string, source: string, location: number): string {
  const columns = asArray(value, "constraint columns");
  if (columns.length !== 1) {
    throw parseError(`unsupported composite ${constraintType.toLowerCase()} constraint`, source, location);
  }
  return expectString(asRecord(asRecord(columns[0], "constraint column").String, "constraint column string").sval, "constraint column", source, location);
}

function findColumn(
  tableName: string,
  columns: MutableColumn[],
  columnName: string,
  source: string,
  location: number,
): MutableColumn {
  const column = columns.find((candidate) => candidate.name === columnName);
  if (!column) {
    throw parseError(`constraint on "${tableName}" targets missing column "${columnName}"`, source, location);
  }
  return column;
}

function literalValue(value: unknown, source: string): string {
  const constant = asRecord(asRecord(value, "literal").A_Const, "literal constant");
  if (isRecord(constant.ival) && typeof constant.ival.ival === "number") {
    return String(constant.ival.ival);
  }
  if (isRecord(constant.fval) && typeof constant.fval.fval === "number") {
    return String(constant.fval.fval);
  }
  if (isRecord(constant.sval) && typeof constant.sval.sval === "string") {
    return constant.sval.sval;
  }
  throw parseError("unsupported type modifier", source, locationOf(constant));
}

function getSqlErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }
  return "failed to parse PostgreSQL schema SQL";
}

function getSqlErrorLine(error: unknown, source: string): number {
  if (isRecord(error) && isRecord(error.sqlDetails)) {
    if (typeof error.sqlDetails.cursorPosition === "number") {
      return lineFromLocation(source, error.sqlDetails.cursorPosition - 1);
    }
  }
  return 1;
}

function parseError(message: string, source: string, location: number): ParseError {
  return new ParseError(message, lineFromLocation(source, location));
}

function lineFromLocation(source: string, location: number): number {
  if (location < 0) {
    return 1;
  }
  return source.slice(0, location).split(/\r?\n/).length;
}

function locationOf(value: unknown): number {
  if (!isRecord(value) || typeof value.location !== "number") {
    return 0;
  }
  return value.location;
}

function asOptionalArray(value: unknown): unknown[] {
  return value === undefined ? [] : asArray(value, "array");
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ParseError(`expected ${label}`, 1);
  }
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ParseError(`expected ${label}`, 1);
  }
  return value;
}

function expectString(value: unknown, label: string, source: string, location: number): string {
  if (typeof value !== "string") {
    throw parseError(`expected ${label}`, source, location);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type MutableColumn = {
  name: string;
  type: string;
  primaryKey: boolean;
  unique: boolean;
  nullable: boolean;
  default?: string;
  references?: ForeignKeyReference;
};
