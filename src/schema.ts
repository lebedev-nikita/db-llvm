export type Schema = {
  readonly tables: Table[];
  readonly indexes: Index[];
};

export type Table = {
  readonly name: string;
  readonly columns: Column[];
};

export type Column = {
  readonly name: string;
  readonly type: string;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly nullable: boolean;
  readonly default?: string;
  readonly references?: ForeignKeyReference;
};

export type ForeignKeyReference = {
  readonly table: string;
  readonly column: string;
  readonly onDelete?: ForeignKeyAction;
};

export type ForeignKeyAction = "cascade" | "restrict" | "set null" | "set default" | "no action";

export type Index = {
  readonly name: string;
  readonly table: string;
  readonly columns: string[];
  readonly unique: boolean;
};

export type NormalizedSchema = Schema;

export type OperationSafety = "safe" | "unsafe";

export type MigrationPlan = {
  readonly operations: MigrationOperation[];
};

export type MigrationOperation =
  | CreateTableOperation
  | DropTableOperation
  | AddColumnOperation
  | DropColumnOperation
  | ChangeColumnOperation
  | AddIndexOperation
  | DropIndexOperation;

export type CreateTableOperation = {
  readonly kind: "create_table";
  readonly safety: "safe";
  readonly table: Table;
};

export type DropTableOperation = {
  readonly kind: "drop_table";
  readonly safety: "unsafe";
  readonly table: Table;
};

export type AddColumnOperation = {
  readonly kind: "add_column";
  readonly safety: OperationSafety;
  readonly tableName: string;
  readonly column: Column;
};

export type DropColumnOperation = {
  readonly kind: "drop_column";
  readonly safety: "unsafe";
  readonly tableName: string;
  readonly column: Column;
};

export type ChangeColumnOperation = {
  readonly kind: "change_column";
  readonly safety: "unsafe";
  readonly tableName: string;
  readonly before: Column;
  readonly after: Column;
  readonly changes: ColumnChange[];
};

export type ColumnChange =
  | "type"
  | "nullable"
  | "default"
  | "primary_key"
  | "unique"
  | "references";

export type AddIndexOperation = {
  readonly kind: "add_index";
  readonly safety: "safe";
  readonly index: Index;
};

export type DropIndexOperation = {
  readonly kind: "drop_index";
  readonly safety: "unsafe";
  readonly index: Index;
};
