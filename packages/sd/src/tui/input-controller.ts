import { useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PendingAttachment } from '../attachments.js';
import { configuredModelsForProvider, listSdProviders } from '../provider.js';
import type { SdRuntime } from '../runtime.js';
import { listSessions } from '../runtime-transitions.js';
import { scrollChatToBottom } from './chat-scroll.js';
import { commandDescriptors, type SdTuiCommand } from './commands.js';
import { defaultCommands, runPaletteCommand, runSlashLine, submitLine } from './input-commands.js';
import {
  buildPromptCompletion,
  type PromptCompletionCatalog,
  type PromptCompletionState,
} from './input-completion.js';
import {
  clampPalette,
  handleGlobalInput,
  handlePaletteInput,
  handlePromptInput,
  type PaletteState,
} from './input-keymap.js';
import { discoverShellCommands } from './shell-completion.js';
import type { SdUiController } from './ui.js';

export interface SdTuiInputOptions {
  runtime: SdRuntime;
  controller: SdUiController;
  exit: () => void;
}

export function useSdTuiInput({ runtime, controller, exit }: SdTuiInputOptions): void {
  const draftRef = useRef('');
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef('');
  const paletteRef = useRef<PaletteState>({ open: false, query: '', selectedIndex: 0 });
  const commandsRef = useRef<SdTuiCommand[]>([]);
  const shellCommandsRef = useRef<string[]>([]);
  const completionRef = useRef<PromptCompletionState | undefined>(undefined);

  const setDraft = useCallback(
    (draft: string, completion?: PromptCompletionState) => {
      draftRef.current = draft;
      const nextCompletion =
        completion ??
        buildPromptCompletion(
          draft,
          commandsRef.current,
          shellCommandsRef.current,
          completionCatalog(runtime),
        );
      completionRef.current = nextCompletion;
      controller.setPromptDraft(draft);
      controller.setPromptCompletion(nextCompletion);
    },
    [controller, runtime],
  );

  const setAttachments = useCallback(
    (attachments: PendingAttachment[]) => {
      attachmentsRef.current = attachments;
      controller.setAttachments(attachments);
    },
    [controller],
  );

  const setPalette = useCallback(
    (patch: Partial<PaletteState>) => {
      const next = clampPalette({ ...paletteRef.current, ...patch }, commandsRef.current);
      paletteRef.current = next;
      controller.setPalette({ ...next, commands: commandDescriptors(commandsRef.current) });
    },
    [controller],
  );

  const runSlashCommand = useCallback(
    async (line: string) => {
      await runSlashLine({
        line,
        runtime,
        controller,
        exit,
        attachmentsRef,
        setAttachments,
        setPalette,
        openSelection: setDraft,
      });
    },
    [controller, exit, runtime, setAttachments, setDraft, setPalette],
  );

  const commands = useMemo<SdTuiCommand[]>(
    () => defaultCommands(runSlashCommand, runtime),
    [runSlashCommand, runtime],
  );

  useEffect(() => {
    shellCommandsRef.current = discoverShellCommands(runtime.agent.cwd);
  }, [runtime]);

  useEffect(() => {
    commandsRef.current = commands;
    controller.setPalette({ ...paletteRef.current, commands: commandDescriptors(commands) });
    completionRef.current = buildPromptCompletion(
      draftRef.current,
      commands,
      shellCommandsRef.current,
      completionCatalog(runtime),
      completionRef.current?.selectedIndex ?? 0,
    );
    controller.setPromptCompletion(completionRef.current);
  }, [commands, controller, runtime]);

  const submit = useCallback(
    async (rawLine: string) => {
      scrollChatToBottom(controller.world);
      await submitLine({
        line: rawLine.trim(),
        runtime,
        controller,
        attachmentsRef,
        historyRef,
        commandsRef,
        setAttachments,
        runSlashCommand,
      });
    },
    [controller, runtime, runSlashCommand, setAttachments],
  );

  const runPaletteSelection = useCallback(async () => {
    await runPaletteCommand(paletteRef, commandsRef, setPalette);
  }, [setPalette]);

  useInput((input, key) => {
    if (
      handleGlobalInput(input, key, {
        controller,
        exit,
        setDraft,
        setPalette,
        paletteRef,
        historyIndexRef,
      })
    ) {
      return;
    }
    if (paletteRef.current.open) {
      void handlePaletteInput(input, key, paletteRef, setPalette, runPaletteSelection);
      return;
    }
    if (controller.isRunning) return;
    handlePromptInput(input, key, {
      draftRef,
      historyRef,
      historyIndexRef,
      historyDraftRef,
      commandsRef,
      shellCommandsRef,
      completionRef,
      completionCatalog: completionCatalog(runtime),
      setDraft,
      submit,
    });
  });
}

function completionCatalog(runtime: SdRuntime): PromptCompletionCatalog {
  return {
    providers: listSdProviders(runtime.config, runtime.provider.id).map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      active: provider.active,
    })),
    models: configuredModelsForProvider(runtime.config, runtime.provider.id).map((id) => ({
      id,
      active: id === runtime.provider.model,
    })),
    sessions: listSessions(runtime).map((session) => ({
      id: session.session_id,
      active: session.session_id === runtime.session?.sessionId,
      updatedAt: session.updated_at,
    })),
    profiles: [
      {
        id: 'none',
        active: runtime.profile === undefined,
        description: runtime.profile ? 'clear active profile' : 'active',
        valid: true,
      },
      ...runtime.profileStore.list().map((profile) => ({
        id: profile.name,
        active: profile.name === runtime.profile?.name,
        description: profile.valid
          ? (profile.config?.description ?? 'profile')
          : (profile.error ?? 'invalid profile'),
        valid: profile.valid,
      })),
    ],
    skills: runtime.skills.list().map((skill) => ({
      id: skill.id,
      command: skill.command,
      description: skill.description,
    })),
  };
}
