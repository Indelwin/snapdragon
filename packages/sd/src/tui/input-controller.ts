import { useInput } from 'ink';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { PendingAttachment } from '../attachments.js';
import type { SdRuntime } from '../runtime.js';
import { scrollChatToBottom } from './chat-scroll.js';
import { commandDescriptors, type SdTuiCommand } from './commands.js';
import { completionCatalogForDraft } from './completion-catalog.js';
import { defaultCommands, runPaletteCommand, runSlashLine, submitLine } from './input-commands.js';
import { buildPromptCompletion, type PromptCompletionState } from './input-completion.js';
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
  const cursorRef = useRef(0);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef('');
  const paletteRef = useRef<PaletteState>({ open: false, query: '', selectedIndex: 0 });
  const commandsRef = useRef<SdTuiCommand[]>([]);
  const shellCommandsRef = useRef<string[]>([]);
  const completionRef = useRef<PromptCompletionState | undefined>(undefined);

  const setDraft = useCallback(
    (draft: string, options?: { cursor?: number; completion?: PromptCompletionState }) => {
      draftRef.current = draft;
      // Default cursor lands at the end of the new draft — natural for
      // history apply, clear, and tab-complete. Explicit-cursor callers
      // (arrow keys, char insert mid-line, etc.) pass it in `options`.
      const cursor = clampCursorOffset(draft, options?.cursor ?? draft.length);
      cursorRef.current = cursor;
      const nextCompletion =
        options?.completion ??
        buildPromptCompletion(
          draft,
          commandsRef.current,
          shellCommandsRef.current,
          completionCatalogForDraft(runtime, draft),
        );
      completionRef.current = nextCompletion;
      controller.setPromptInput(draft, nextCompletion, cursor);
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
      completionCatalogForDraft(runtime, draftRef.current),
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
      cursorRef,
      historyRef,
      historyIndexRef,
      historyDraftRef,
      commandsRef,
      shellCommandsRef,
      completionRef,
      completionCatalog: completionCatalogForDraft(runtime, draftRef.current),
      setDraft,
      submit,
    });
  });
}

function clampCursorOffset(text: string, cursor: number): number {
  if (cursor < 0) return 0;
  if (cursor > text.length) return text.length;
  return cursor;
}
