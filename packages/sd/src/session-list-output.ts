import type { Writable } from 'node:stream';
import { loadSdConfig } from './config.js';
import { listRuntimeSessions } from './runtime-session.js';
import { summaryForSession } from './session-info.js';

export async function printSessionList(configPath: string, output: Writable): Promise<void> {
  const config = await loadSdConfig(configPath);
  const sessions = listRuntimeSessions(config);
  if (sessions.length === 0) {
    output.write('No sessions found.\n');
    return;
  }
  output.write(
    sessions
      .map((session) => {
        const title = summaryForSession(config, session.session_id)?.title;
        const suffix = title ? `\t${title}` : '';
        const updated = new Date(session.updated_at * 1000).toISOString();
        return `${session.session_id}\t${updated}\t${session.jsonl_size} bytes${suffix}`;
      })
      .join('\n')
      .concat('\n'),
  );
}
