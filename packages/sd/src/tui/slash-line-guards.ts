import type { SdUiController } from './ui.js';

export function togglePanel(line: string, c: SdUiController): void {
  const tools = line === '/tools-panel';
  if (tools) c.toggleToolPanel();
  else c.toggleEventPanel();
  c.appendCommandOutput(`Toggled ${tools ? 'tools' : 'events'} panel.`);
}

export function isTranscriptResetCommand(line: string): boolean {
  return (
    line.startsWith('/resume') || line.startsWith('/new-session') || line.startsWith('/profile')
  );
}

export function isRuntimeTransitionCommand(line: string): boolean {
  return (
    line.startsWith('/provider') ||
    line.startsWith('/model') ||
    line.startsWith('/resume') ||
    line.startsWith('/new-session') ||
    line.startsWith('/delete-session') ||
    line.startsWith('/profile') ||
    line === '/extensions reload' ||
    line.startsWith('/reload')
  );
}
