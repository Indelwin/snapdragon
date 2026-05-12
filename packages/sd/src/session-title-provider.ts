import type { LlmChatResponse } from '@snapdragon-ai/host';
import type { JsonlSession } from '@snapdragon-ai/session';
import { makeSdProvider } from './provider.js';
import type { SdRuntime } from './runtime.js';
import { messageText } from './session-summary.js';
import type { EnsureSessionTitleOptions, GeneratedTitle } from './session-title.js';

const TITLE_SYSTEM_PROMPT =
  'Generate a concise title for this coding-agent session. Return only the title, no quotes, no punctuation at the end.';

export async function tryGenerateProviderTitle(
  runtime: SdRuntime,
  options: EnsureSessionTitleOptions,
): Promise<GeneratedTitle | undefined> {
  const prompt = titlePrompt(runtime.session);
  if (!prompt) return undefined;
  const provider = makeTitleProvider(runtime, options);
  const response = await provider.handler(
    {
      role: 'assistant',
      messages: [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      tool_choice: 'none',
      max_tokens: titleMaxTokens(runtime, options),
      temperature: 0,
    },
    {
      runId: `title_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      emit: () => undefined,
    },
  );
  return generatedTitle(response, provider);
}

function makeTitleProvider(runtime: SdRuntime, options: EnsureSessionTitleOptions) {
  return makeSdProvider(
    runtime.config,
    { provider: titleProvider(runtime, options), model: titleModel(runtime, options) },
    runtime.env,
    runtime.extensionRuntime?.providers,
  );
}

function generatedTitle(
  response: LlmChatResponse,
  provider: { id: string; model: string },
): GeneratedTitle {
  return {
    text: response.content,
    provider: provider.id,
    model: provider.model,
  };
}

function titlePrompt(session: JsonlSession | undefined): string | undefined {
  const messages = session?.recentMessages(20).messages ?? [];
  const user = messages.find((message) => message.role === 'user');
  if (!user) return undefined;
  const assistant = messages.find((message) => message.role === 'assistant');
  return [
    'First user message:',
    messageText(user).slice(0, 1200),
    assistant ? '\nFirst assistant response:' : '',
    assistant ? messageText(assistant).slice(0, 1200) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function titleProvider(runtime: SdRuntime, options: EnsureSessionTitleOptions): string | undefined {
  return options.provider ?? runtime.config.sessions?.title?.provider;
}

function titleModel(runtime: SdRuntime, options: EnsureSessionTitleOptions): string | undefined {
  return options.model ?? runtime.config.sessions?.title?.model;
}

function titleMaxTokens(runtime: SdRuntime, options: EnsureSessionTitleOptions): number {
  return options.maxTokens ?? runtime.config.sessions?.title?.max_tokens ?? 48;
}
