import type { MutableRefObject } from 'react';
import type { PendingAttachment } from '../attachments.js';
import type { SdRuntime } from '../runtime.js';
import type { PromptCompletionState } from './input-completion.js';
import type { PaletteState } from './input-keymap.js';
import type { SdUiController } from './ui.js';

export interface RunSlashLineArgs {
  line: string;
  runtime: SdRuntime;
  controller: SdUiController;
  exit: () => void;
  attachmentsRef: MutableRefObject<PendingAttachment[]>;
  setAttachments: (attachments: PendingAttachment[]) => void;
  setPalette: (patch: Partial<PaletteState>) => void;
  openSelection?: (draft: string, options?: { completion?: PromptCompletionState }) => void;
}
