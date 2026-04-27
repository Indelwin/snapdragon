import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillCatalog, SkillManageRequest } from '@snapdragon-ai/content';
import { skillToolset, ToolRegistry } from '../src/index.ts';

test('skill toolset lists, searches, loads, and delegates authoring', async () => {
  const requests: SkillManageRequest[] = [];
  const catalog: SkillCatalog = {
    list: () => [
      {
        id: 'quality/code-review',
        name: 'code-review',
        description: 'Review code',
        command: '/code-review',
        aliases: [],
        category: 'quality',
        tags: ['review'],
      },
    ],
    search: (query) =>
      query.includes('review')
        ? [
            {
              id: 'quality/code-review',
              name: 'code-review',
              description: 'Review code',
              command: '/code-review',
              aliases: [],
              category: 'quality',
              tags: ['review'],
            },
          ]
        : [],
    load: (target) =>
      target === 'quality/code-review'
        ? {
            id: 'quality/code-review',
            name: 'code-review',
            description: 'Review code',
            command: '/code-review',
            aliases: [],
            category: 'quality',
            tags: ['review'],
            frontmatter: { name: 'code-review', description: 'Review code' },
            body: 'Read the diff.',
            raw: '',
          }
        : undefined,
    manage: (request) => {
      requests.push(request);
      return { success: true, action: request.action, message: 'ok' };
    },
  };
  const registry = new ToolRegistry({ cwd: process.cwd() });
  await registry.register(skillToolset({ catalog, authoring: true }));

  assert.match((await registry.invoke('skills_list', {})).content, /quality\/code-review/);
  assert.match(
    (await registry.invoke('skills_search', { query: 'review' })).content,
    /Review code/,
  );
  assert.match(
    (await registry.invoke('skill_load', { id: 'quality/code-review' })).content,
    /Read the diff/,
  );
  assert.equal(
    (await registry.invoke('skill_manage', { action: 'delete', id: 'x' })).isError,
    false,
  );
  assert.equal(requests[0]?.action, 'delete');
});

test('skill authoring can be disabled', async () => {
  const registry = new ToolRegistry({ cwd: process.cwd() });
  await registry.register(
    skillToolset({
      catalog: { list: () => [], search: () => [], load: () => undefined },
      authoring: false,
    }),
  );

  const result = await registry.invoke('skill_manage', { action: 'delete', id: 'x' });
  assert.equal(result.isError, true);
  assert.match(result.content, /disabled/);
});
