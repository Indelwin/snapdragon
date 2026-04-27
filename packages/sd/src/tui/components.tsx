import { InkRendererRegistry } from './renderer-registry.js';
import { ChatTranscript } from './renderers/chat.js';
import { KeybindBar } from './renderers/keybinds.js';
import { CommandPalette } from './renderers/palette.js';
import { EventLog, ToolPanel } from './renderers/panels.js';
import { PromptInput } from './renderers/prompt.js';
import { SplashBanner } from './renderers/splash.js';
import { RunStatus, SessionStatus } from './renderers/status.js';

export function createDefaultInkRendererRegistry(): InkRendererRegistry {
  const registry = new InkRendererRegistry();
  registry.register('session.status', (component, context) => (
    <SessionStatus component={component} snapshot={context.snapshot} />
  ));
  registry.register('run.status', (component) => <RunStatus component={component} />);
  registry.register('splash.banner', (component) => <SplashBanner component={component} />);
  registry.register('chat.transcript', (component, context) => (
    <ChatTranscript component={component} viewportRows={context.viewportRows} />
  ));
  registry.register('tool.panel', (component) => <ToolPanel component={component} />);
  registry.register('event.log', (component) => <EventLog component={component} />);
  registry.register('command.palette', (component) => <CommandPalette component={component} />);
  registry.register('prompt.input', (component) => <PromptInput component={component} />);
  registry.register('keybind.bar', (component) => <KeybindBar component={component} />);
  return registry;
}
