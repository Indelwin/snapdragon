import type {
  LoadedSkill,
  SkillCatalog,
  SkillDescriptor,
  SkillLinkedFiles,
  SkillManageRequest,
} from '@snapdragon-ai/content';
import type { JsonObject, JsonValue } from '@snapdragon-ai/core';
import { objectArg, optionalNumberArg, stringArg } from '../safety.js';
import type { Tool, ToolResult, Toolset } from '../types.js';

export interface SkillToolsetOptions {
  catalog: SkillCatalog;
  authoring?: boolean;
}

export function skillToolset(options: SkillToolsetOptions): Toolset {
  return {
    name: 'skill',
    title: 'Skill tools',
    description: 'List, search, load, and manage descriptor-first agent skills.',
    tools: [
      skillsListTool(options.catalog),
      skillsSearchTool(options.catalog),
      skillLoadTool(options.catalog),
      skillManageTool(options.catalog, options.authoring ?? false),
    ],
  };
}

function skillsListTool(catalog: SkillCatalog): Tool {
  return {
    name: 'skills_list',
    toolset: 'skill',
    description: 'List available skill descriptors. Skill bodies are not returned.',
    parameters: schema(
      {
        query: { type: 'string', description: 'Optional descriptor search query.' },
        limit: { type: 'number', default: 50 },
      },
      [],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArgOrEmpty(args);
      const limit = boundedLimit(optionalNumberArg(input, 'limit') ?? 50);
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const skills = query
        ? await catalog.search(query, limit)
        : (await catalog.list()).slice(0, limit);
      return descriptorResult(skills);
    },
  };
}

function skillsSearchTool(catalog: SkillCatalog): Tool {
  return {
    name: 'skills_search',
    toolset: 'skill',
    description: 'Search skill descriptors by name, description, category, and tags.',
    parameters: schema(
      {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'number', default: 10 },
      },
      ['query'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const skills = await catalog.search(
        stringArg(input, 'query'),
        boundedLimit(optionalNumberArg(input, 'limit') ?? 10),
      );
      return descriptorResult(skills);
    },
  };
}

function skillLoadTool(catalog: SkillCatalog): Tool {
  return {
    name: 'skill_load',
    toolset: 'skill',
    description: 'Load the full body and supporting-file list for a skill.',
    parameters: schema(
      {
        id: { type: 'string', description: 'Skill id, name, or command slug.' },
      },
      ['id'],
    ),
    async run(args): Promise<ToolResult> {
      const input = objectArg(args);
      const skill = await catalog.load(stringArg(input, 'id'));
      if (!skill) return { content: 'Skill not found.', isError: true };
      return {
        content: [
          `# ${skill.name}`,
          '',
          skill.description,
          '',
          skill.body,
          '',
          supportingFilesBlock(skill),
        ]
          .filter(Boolean)
          .join('\n'),
        data: jsonData({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          dir: skill.dir,
          path: skill.path,
          linked_files: skill.linkedFiles,
        }),
      };
    },
  };
}

function skillManageTool(catalog: SkillCatalog, authoring: boolean): Tool {
  return {
    name: 'skill_manage',
    toolset: 'skill',
    description: 'Create, edit, patch, delete, or update supporting files for writable skills.',
    parameters: schema(
      {
        action: {
          type: 'string',
          enum: ['create', 'edit', 'patch', 'delete', 'write_file', 'remove_file'],
        },
        id: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string' },
        file_path: { type: 'string' },
        file_content: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean', default: false },
      },
      ['action'],
    ),
    async run(args): Promise<ToolResult> {
      if (!authoring) return { content: 'Skill authoring is disabled.', isError: true };
      if (!catalog.manage) {
        return { content: 'This skill catalog does not support authoring.', isError: true };
      }
      const request = objectArg(args) as unknown as SkillManageRequest;
      const result = await catalog.manage(request);
      return {
        content: result.success
          ? (result.message ?? 'Skill updated.')
          : (result.error ?? 'Skill update failed.'),
        isError: !result.success,
        data: jsonData(result),
      };
    },
  };
}

function descriptorResult(skills: SkillDescriptor[]): ToolResult {
  return {
    content:
      skills.map((skill) => `${skill.id} (${skill.name}) - ${skill.description}`).join('\n') ||
      '(no skills)',
    data: jsonData({ skills }),
  };
}

function supportingFilesBlock(skill: LoadedSkill): string {
  const lines = linkedFileEntries(skill.linkedFiles).map(([kind, file]) => `- ${kind}/${file}`);
  return lines.length ? ['Supporting files:', ...lines].join('\n') : '';
}

function linkedFileEntries(linked: SkillLinkedFiles | undefined): Array<[string, string]> {
  if (!linked) return [];
  return [
    ...(linked.references ?? []).map((file): [string, string] => ['references', file]),
    ...(linked.templates ?? []).map((file): [string, string] => ['templates', file]),
    ...(linked.scripts ?? []).map((file): [string, string] => ['scripts', file]),
    ...(linked.assets ?? []).map((file): [string, string] => ['assets', file]),
  ];
}

function jsonData(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function objectArgOrEmpty(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return objectArg(value);
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(Math.floor(limit), 100));
}

function schema(properties: Record<string, JsonObject>, required: string[]): JsonObject {
  return { type: 'object', properties, required, additionalProperties: false };
}
