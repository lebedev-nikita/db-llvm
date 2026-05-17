import type { Column, ForeignKeyAction, ForeignKeyReference, Index, Schema, Table } from "./schema.js";

const identifierPattern = "[A-Za-z_][A-Za-z0-9_]*";

export class ParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = "ParseError";
  }
}

export function parseSchema(source: string): Schema {
  const tables: Table[] = [];
  const indexes: Index[] = [];
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = cleanLine(lines[index] ?? "");

    if (line === "") {
      continue;
    }

    const tableMatch = line.match(new RegExp(`^table\\s+(${identifierPattern})\\s*\\{$`));
    if (tableMatch) {
      const [table, nextIndex] = parseTable(tableMatch[1]!, lines, index + 1);
      tables.push(table);
      index = nextIndex;
      continue;
    }

    const indexMatch = line.match(
      new RegExp(`^(unique\\s+)?index\\s+(${identifierPattern})\\s+on\\s+(${identifierPattern})\\(([^)]+)\\)$`),
    );
    if (indexMatch) {
      indexes.push({
        unique: Boolean(indexMatch[1]),
        name: indexMatch[2]!,
        table: indexMatch[3]!,
        columns: splitColumnList(indexMatch[4]!, lineNumber),
      });
      continue;
    }

    throw new ParseError("expected a table block or index declaration", lineNumber);
  }

  return { tables, indexes };
}

function parseTable(name: string, lines: string[], startIndex: number): readonly [Table, number] {
  const columns: Column[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = cleanLine(lines[index] ?? "");

    if (line === "") {
      continue;
    }

    if (line === "}") {
      return [{ name, columns }, index];
    }

    columns.push(parseColumn(line, lineNumber));
  }

  throw new ParseError(`table "${name}" is missing a closing brace`, startIndex);
}

function parseColumn(line: string, lineNumber: number): Column {
  const match = line.match(new RegExp(`^(${identifierPattern})\\s+(${identifierPattern})(?:\\s+(.*))?$`));
  if (!match) {
    throw new ParseError("expected column declaration: <name> <type> [attributes]", lineNumber);
  }

  const tokens = tokenizeAttributes(match[3] ?? "");
  const column: MutableColumn = {
    name: match[1]!,
    type: match[2]!,
    primaryKey: false,
    unique: false,
    nullable: true,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token === "primary") {
      expectToken(tokens, index + 1, "key", lineNumber);
      column.primaryKey = true;
      column.nullable = false;
      index += 1;
      continue;
    }

    if (token === "unique") {
      column.unique = true;
      continue;
    }

    if (token === "not") {
      expectToken(tokens, index + 1, "null", lineNumber);
      column.nullable = false;
      index += 1;
      continue;
    }

    if (token === "default") {
      const value = tokens[index + 1];
      if (!value) {
        throw new ParseError("default requires a value", lineNumber);
      }
      column.default = value;
      index += 1;
      continue;
    }

    if (token === "references") {
      const target = tokens[index + 1];
      if (!target) {
        throw new ParseError("references requires <table>.<column>", lineNumber);
      }
      const reference = parseReferenceTarget(target, lineNumber);
      index += 1;

      if (tokens[index + 1] === "on") {
        expectToken(tokens, index + 2, "delete", lineNumber);
        const [action, nextIndex] = parseForeignKeyAction(tokens, index + 3, lineNumber);
        column.references = { ...reference, onDelete: action };
        index = nextIndex;
      } else {
        column.references = reference;
      }
      continue;
    }

    throw new ParseError(`unknown column attribute "${token}"`, lineNumber);
  }

  return {
    name: column.name,
    type: column.type,
    primaryKey: column.primaryKey,
    unique: column.unique,
    nullable: column.nullable,
    ...(column.default === undefined ? {} : { default: column.default }),
    ...(column.references === undefined ? {} : { references: column.references }),
  };
}

function cleanLine(line: string): string {
  return line.replace(/#.*/, "").replace(/\/\/.*/, "").trim();
}

function tokenizeAttributes(input: string): string[] {
  return input.trim() === "" ? [] : input.match(/\S+\([^)]*\)|\S+/g) ?? [];
}

function expectToken(tokens: readonly string[], index: number, expected: string, lineNumber: number): void {
  if (tokens[index] !== expected) {
    throw new ParseError(`expected "${expected}"`, lineNumber);
  }
}

function parseReferenceTarget(target: string, lineNumber: number): ForeignKeyReference {
  const match = target.match(new RegExp(`^(${identifierPattern})\\.(${identifierPattern})$`));
  if (!match) {
    throw new ParseError("references target must be <table>.<column>", lineNumber);
  }

  return { table: match[1]!, column: match[2]! };
}

function parseForeignKeyAction(
  tokens: readonly string[],
  startIndex: number,
  lineNumber: number,
): readonly [ForeignKeyAction, number] {
  const token = tokens[startIndex];
  if (!token) {
    throw new ParseError("on delete requires an action", lineNumber);
  }

  if (token === "set") {
    const next = tokens[startIndex + 1];
    if (next === "null" || next === "default") {
      return [`set ${next}`, startIndex + 1];
    }
  }

  if (token === "no") {
    expectToken(tokens, startIndex + 1, "action", lineNumber);
    return ["no action", startIndex + 1];
  }

  if (token === "cascade" || token === "restrict") {
    return [token, startIndex];
  }

  throw new ParseError(`unsupported on delete action "${token}"`, lineNumber);
}

function splitColumnList(input: string, lineNumber: number): string[] {
  const columns = input.split(",").map((column) => column.trim()).filter(Boolean);
  if (columns.length === 0) {
    throw new ParseError("index requires at least one column", lineNumber);
  }

  for (const column of columns) {
    if (!new RegExp(`^${identifierPattern}$`).test(column)) {
      throw new ParseError(`invalid index column "${column}"`, lineNumber);
    }
  }

  return columns;
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
