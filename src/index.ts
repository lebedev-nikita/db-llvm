export { diffSchemas } from "./diff.js";
export { normalizeSchema, parseSnapshot, SchemaValidationError, serializeSnapshot } from "./normalize.js";
export { ParseError, parseSchema } from "./parser.js";
export { generatePostgresCreateSchema, generatePostgresMigration } from "./postgres.js";
export type {
  AddColumnOperation,
  AddIndexOperation,
  ChangeColumnOperation,
  Column,
  ColumnChange,
  CreateTableOperation,
  DropColumnOperation,
  DropIndexOperation,
  DropTableOperation,
  ForeignKeyAction,
  ForeignKeyReference,
  Index,
  MigrationOperation,
  MigrationPlan,
  NormalizedSchema,
  OperationSafety,
  Schema,
  Table,
} from "./schema.js";
