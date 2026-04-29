import type { SdRuntime } from '../runtime.js';
import { profileCompletionCatalog } from './completion-catalog-profiles.js';
import {
  modelCompletionCatalog,
  providerCompletionCatalog,
} from './completion-catalog-providers.js';
import { sessionCompletionCatalog } from './completion-catalog-sessions.js';
import { skillCompletionCatalog } from './completion-catalog-skills.js';
import type { PromptCompletionCatalog } from './input-completion.js';

type CatalogBuilder = (runtime: SdRuntime) => PromptCompletionCatalog;

const CATALOG_BUILDERS: Record<string, CatalogBuilder> = {
  '/provider': providerCompletionCatalog,
  '/providers': providerCompletionCatalog,
  '/model': modelCompletionCatalog,
  '/resume': sessionCompletionCatalog,
  '/delete-session': sessionCompletionCatalog,
  '/profile': profileCompletionCatalog,
  '/skill': skillCompletionCatalog,
};

export function completionCatalogForDraft(
  runtime: SdRuntime,
  draft: string,
): PromptCompletionCatalog {
  if (!draft.startsWith('/')) return {};
  const command = draft.split(/\s+/)[0] || '';
  const buildCatalog = CATALOG_BUILDERS[command];
  if (buildCatalog === undefined) return {};
  return buildCatalog(runtime);
}
