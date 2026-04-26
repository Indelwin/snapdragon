export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type FieldType =
  | { type: 'string' }
  | { type: 'bool' }
  | { type: 'enum'; values: string[] }
  | { type: 'list'; inner: FieldType }
  | { type: 'optional'; inner: FieldType };

export interface Field {
  name: string;
  doc?: string;
  type: FieldType['type'];
  values?: string[];
  inner?: FieldType;
}

export interface Signature {
  name: string;
  doc?: string;
  inputs: Field[];
  outputs: Field[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonObject;
}

export interface Bundle {
  $schema: 1;
  program_id: string;
  program_version: string;
  module_type?: string;
  instructions?: string;
  signature?: Signature;
  tools?: ToolDefinition[];
  requires?: string[];
  schedule?: Schedule;
  metadata?: JsonObject;
}

export interface Schedule {
  steps: ScheduleStep[];
}

export type ScheduleStep =
  | {
      kind: 'invoke';
      id: string;
      system: string;
      args?: JsonObject;
    }
  | {
      kind: 'loop';
      id: string;
      until: LoopPredicate;
      body: ScheduleStep[];
      max_iters?: number;
    };

export type LoopPredicate =
  | {
      kind: 'component_presence';
      component: string;
      present: boolean;
    }
  | {
      kind: 'terminal';
    };

export function defineBundle<T extends Bundle>(bundle: T): T {
  return bundle;
}

export const componentArtifactUrl = new URL('./snapdragon_core.wasm', import.meta.url);

export function createChatBundle(args: {
  programId: string;
  programVersion?: string;
  instructions: string;
  tools?: ToolDefinition[];
  metadata?: JsonObject;
}): Bundle {
  return {
    $schema: 1,
    program_id: args.programId,
    program_version: args.programVersion ?? '0.1.0',
    module_type: 'chat_react',
    instructions: args.instructions,
    tools: args.tools ?? [],
    requires: ['predict'],
    metadata: args.metadata,
  };
}
