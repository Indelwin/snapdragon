import { configuredModelsForProvider, discoverSdModels } from '../provider.js';
import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';
import type { PromptSelection } from './input-selection.js';

interface SelectableModel {
  id: string;
  name?: string;
  source?: string;
}

export async function modelSelection(
  runtime: SdRuntime,
  providerId: string,
): Promise<PromptSelection> {
  const { models, warning } = await selectableModels(runtime, providerId);
  return {
    draft: modelDraft(runtime, providerId),
    warning,
    completion: modelCompletion(models, runtime, providerId),
  };
}

function modelCompletion(
  models: SelectableModel[],
  runtime: SdRuntime,
  providerId: string,
): PromptCompletionState {
  return {
    mode: 'model',
    query: '',
    selectedIndex: selectedModelIndex(models, runtime, providerId),
    suggestions: models.map((model) => ({
      label: model.id,
      description: modelDescription(model, runtime, providerId),
      insertText: modelInsertText(model.id, runtime, providerId),
      kind: 'model',
    })),
  };
}

async function selectableModels(
  runtime: SdRuntime,
  providerId: string,
): Promise<{ models: SelectableModel[]; warning?: string }> {
  try {
    const models = await discoverSdModels(runtime.config, providerId);
    if (models.length > 0) return { models };
    return configuredFallback(runtime, providerId, 'live model discovery returned no models');
  } catch (error) {
    return configuredFallback(
      runtime,
      providerId,
      `live model discovery failed: ${errorMessage(error)}`,
      error,
    );
  }
}

function configuredFallback(
  runtime: SdRuntime,
  providerId: string,
  warning: string,
  cause?: unknown,
): { models: SelectableModel[]; warning?: string } {
  const models = configuredModelsForProvider(runtime.config, providerId).map((id) => ({
    id,
    source: 'configured',
  }));
  if (models.length === 0 && cause) throw cause;
  return { models, warning };
}

function modelDraft(runtime: SdRuntime, providerId: string): string {
  return providerId === runtime.provider.id ? '/model ' : `/provider ${providerId} `;
}

function modelInsertText(modelId: string, runtime: SdRuntime, providerId: string): string {
  return providerId === runtime.provider.id
    ? `/model ${modelId}`
    : `/provider ${providerId} ${modelId}`;
}

function modelDescription(model: SelectableModel, runtime: SdRuntime, providerId: string): string {
  return [model.name ?? model.source ?? 'model', activeModelLabel(model.id, runtime, providerId)]
    .filter(Boolean)
    .join(' ');
}

function selectedModelIndex(
  models: Array<{ id: string }>,
  runtime: SdRuntime,
  providerId: string,
): number {
  return Math.max(
    0,
    models.findIndex((model) => Boolean(activeModelLabel(model.id, runtime, providerId))),
  );
}

function activeModelLabel(modelId: string, runtime: SdRuntime, providerId: string): string {
  return providerId === runtime.provider.id && modelId === runtime.provider.model ? 'active' : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
