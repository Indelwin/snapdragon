import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import type { SdCliArgs, SdCliMode } from './args-types.js';
import { helpText } from './help.js';
import type { SdProfileInfo } from './profile.js';

type CommandHandler = (args: SdCliArgs) => Promise<void> | void;

const commandHandlers: Partial<Record<SdCliMode, CommandHandler>> = {
  help: () => {
    stdout.write(helpText);
  },
  version: async () => {
    stdout.write(`${await readPackageVersion()}\n`);
  },
  doctor: runDoctorCommand,
  setup: (args) => setup(args.configPath, args.profileRoot),
  'list-sessions': (args) => listSessions(args.configPath),
  'delete-session': (args) => deleteSession(args.configPath, args.deleteSessionId),
  'list-profiles': (args) => listProfiles(args.profileRoot),
  daemon: runDaemonCommand,
  gateway: runGatewayCommand,
};

async function runDoctorCommand(args: SdCliArgs): Promise<void> {
  const [{ collectSdDoctorReport }, { formatSdDoctorReport }] = await Promise.all([
    import('./doctor.js'),
    import('./doctor-format.js'),
  ]);
  stdout.write(formatSdDoctorReport(await collectSdDoctorReport(), args.json === true));
}

export async function runPreRuntimeCommand(args: SdCliArgs): Promise<boolean> {
  const handler = commandHandlers[args.mode];
  if (!handler) return false;
  await handler(args);
  return true;
}

async function runDaemonCommand(args: SdCliArgs): Promise<void> {
  const {
    runSdDaemon,
    runSdDaemonOnce,
    sdDaemonStatus,
    startSdDaemon,
    stopSdDaemon,
    writeDaemonResult,
  } = await import('./daemon.js');
  const action = args.daemonAction ?? 'run';
  const handlers = {
    run: runSdDaemon,
    start: startSdDaemon,
    stop: stopSdDaemon,
    status: sdDaemonStatus,
    'run-once': runSdDaemonOnce,
  };
  const result = handlers[action](args);
  if (action === 'run') await result;
  else await writeDaemonResult(result as Promise<string>);
}

async function runGatewayCommand(args: SdCliArgs): Promise<void> {
  const { runGatewayCommand: executeGatewayCommand } = await import('./gateway-command.js');
  stdout.write(await executeGatewayCommand(args));
}

async function listSessions(configPath: string): Promise<void> {
  const { printSessionList } = await import('./session-list-output.js');
  await printSessionList(configPath, stdout);
}

async function deleteSession(configPath: string, sessionId: string | undefined): Promise<void> {
  if (!sessionId) throw new Error('--delete-session requires an id');
  const { loadSdConfig } = await import('./config.js');
  const config = await loadSdConfig(configPath);
  const { runtimeSessionStore } = await import('./runtime-session.js');
  const deleted = runtimeSessionStore(config).delete(sessionId);
  stdout.write(deleted ? `Deleted session ${sessionId}\n` : `Session not found: ${sessionId}\n`);
}

async function listProfiles(profileRoot: string | undefined): Promise<void> {
  const { SdProfileStore } = await import('./profile.js');
  printProfiles(new SdProfileStore({ root: profileRoot }).list());
}

function printProfiles(profiles: SdProfileInfo[]): void {
  if (profiles.length === 0) {
    stdout.write('No profiles found.\n');
    return;
  }
  stdout.write(profiles.map(profileLine).join('\n').concat('\n'));
}

function profileLine(profile: SdProfileInfo): string {
  if (!profile.valid) return `! ${profile.name}\t${profile.error}`;
  const active = profile.active ? '*' : ' ';
  const description = profile.config?.description ? `\t${profile.config.description}` : '';
  return `${active} ${profile.name}${description}`;
}

async function setup(configPath: string, profileRoot?: string): Promise<void> {
  const [configModule, firstPartyModule, profileModule, skillsModule] = await Promise.all([
    import('./config.js'),
    import('./first-party.js'),
    import('./profile.js'),
    import('./skills.js'),
  ]);
  const {
    DEFAULT_SD_ENV_PATH,
    DEFAULT_SD_EXTENSION_ROOT,
    loadSdConfig,
    writeDefaultConfig,
    writeEnvTemplate,
  } = configModule;
  const { ensureFirstPartyExtensions, ensureFirstPartyProfiles, ensureFirstPartySkills } =
    firstPartyModule;
  const { SdProfileStore } = profileModule;
  const { DEFAULT_SD_SKILL_ROOT } = skillsModule;
  const wroteConfig = await writeDefaultConfig(configPath);
  const wroteEnv = await writeEnvTemplate();
  const config = await loadSdConfig(configPath);
  ensureFirstPartySkills(config.skills?.root ?? DEFAULT_SD_SKILL_ROOT);
  ensureFirstPartyExtensions(config.extensions?.roots?.[0] ?? DEFAULT_SD_EXTENSION_ROOT);
  ensureFirstPartyProfiles(new SdProfileStore({ root: profileRoot }).root);
  stdout.write(
    [
      wroteConfig ? `Created ${configPath}` : `Config already exists: ${configPath}`,
      wroteEnv
        ? `Created ${DEFAULT_SD_ENV_PATH}`
        : `Env file already exists: ${DEFAULT_SD_ENV_PATH}`,
      'Installed first-party skills, extensions, and profile templates.',
      '',
    ].join('\n'),
  );
}

async function readPackageVersion(): Promise<string> {
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const version = packageJson.version;
  if (typeof version === 'string') return version;
  return 'unknown';
}
