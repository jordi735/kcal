// Runs in a separate Node process so the provider override cannot affect other
// tests. The production runner and repository-local Codex CLI both run unchanged.
import childProcess, { type ChildProcess, type SpawnOptions } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CodexInput, CodexJsonTurn, CodexRunOptions } from '../../server/types';

export type ProbeInput = {
  baseUrl: string;
  input: CodexInput;
  options: CodexRunOptions;
  discoveryFault?: 'timeout' | 'output-limit';
};

export type ProbeOutput = (
  | { ok: true; turn: CodexJsonTurn }
  | { ok: false; error: string }
) & { cliStarted: boolean; schemaRemoved: boolean; discoveryDescendantStarted?: boolean };

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const probe = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ProbeInput;
const endpoint = new URL(probe.baseUrl);
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') {
  throw new Error('The runner probe requires a loopback HTTP provider');
}

const require = createRequire(import.meta.url);
const cliPath = require.resolve('@openai/codex/bin/codex.js');
const realSpawn = childProcess.spawn;
const authDirectory = await mkdtemp(path.join(tmpdir(), 'kcal-runner-auth-'));
process.env.CODEX_HOME = authDirectory;
// Both bundled metadata discovery and inference must ignore ambient config;
// neither operation can obtain usable authentication from this isolated home.
await writeFile(path.join(authDirectory, 'config.toml'), 'INVALID TOML [');
await writeFile(path.join(authDirectory, 'auth.json'), 'INVALID JSON');
let cli: ChildProcess | null = null;
let schemaPath: string | undefined;
const activeProcesses = new Set<ChildProcess>();
const descendantMarker = path.join(authDirectory, 'discovery-descendant-started');
let discoveryDescendantStarted = false;

// Keep every safety flag supplied by runCodexJsonTurn. Only route its real CLI
// to the local fixture, suppress provider authentication/retries, and make the
// outgoing JSON body readable. No prompt or generated CLI output is replaced.
const providerConfig = [
  'model_provider="kcal-offline-test"',
  'model_providers.kcal-offline-test.name="Local runner test"',
  `model_providers.kcal-offline-test.base_url=${JSON.stringify(probe.baseUrl)}`,
  'model_providers.kcal-offline-test.wire_api="responses"',
  'model_providers.kcal-offline-test.requires_openai_auth=false',
  'model_providers.kcal-offline-test.supports_websockets=false',
  'model_providers.kcal-offline-test.request_max_retries=0',
  'model_providers.kcal-offline-test.stream_max_retries=0',
  'features.enable_request_compression=false',
];

function trackProcess(proc: ChildProcess): ChildProcess {
  activeProcesses.add(proc);
  // Wait for close, rather than exit: an exited wrapper can leave its native
  // descendant holding the pipes open, which is the discovery regression.
  proc.once('close', () => { activeProcesses.delete(proc); });
  return proc;
}

function stopProcesses() {
  for (const proc of activeProcesses) {
    if (proc.pid === undefined) continue;
    try {
      if (process.platform === 'win32') proc.kill('SIGKILL');
      else process.kill(-proc.pid, 'SIGKILL');
    } catch {
      // A completed process group can disappear just before cleanup.
    }
  }
}

process.once('SIGTERM', () => {
  stopProcesses();
  process.exit(1);
});

const spawnWithLocalProvider = (command: string, args: readonly string[], options: SpawnOptions) => {
  if (command !== process.execPath || args[0] !== cliPath) {
    throw new Error('Unexpected subprocess in the runner probe');
  }
  if (args[1] === 'debug' && args[2] === 'models' && args[3] === '--bundled') {
    if (probe.discoveryFault === undefined) {
      return trackProcess(realSpawn(command, args, options));
    }
    // Fault cases exercise real process groups without running inference. The
    // descendant inherits the wrapper's pipes, so killing only the wrapper
    // cannot settle the production runner's close event.
    const fixture = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const child = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      child.once('spawn', () => {
        writeFileSync(process.argv[1], 'ready');
        if (process.argv[2] === 'output-limit') process.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1));
      });
      setInterval(() => {}, 1000);
    `;
    return trackProcess(realSpawn(command, ['--eval', fixture, descendantMarker, probe.discoveryFault], options));
  }
  const schemaIndex = args.indexOf('--output-schema');
  schemaPath = schemaIndex < 0 ? undefined : args[schemaIndex + 1];
  cli = trackProcess(realSpawn(command, [...args, ...providerConfig.flatMap((value) => ['--config', value])], {
    ...options,
    env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', CODEX_HOME: authDirectory },
  }));
  return cli;
};

Object.defineProperty(childProcess, 'spawn', { value: spawnWithLocalProvider });
syncBuiltinESMExports();

let result: Omit<Extract<ProbeOutput, { ok: true }>, 'schemaRemoved' | 'cliStarted'>
  | Omit<Extract<ProbeOutput, { ok: false }>, 'schemaRemoved' | 'cliStarted'>;
try {
  const { runCodexJsonTurn } = await import('../../server/codex-runner.js');
  result = { ok: true, turn: await runCodexJsonTurn(probe.input, probe.options) };
} catch (error) {
  result = { ok: false, error: error instanceof Error ? error.message : String(error) };
} finally {
  stopProcesses();
  Object.defineProperty(childProcess, 'spawn', { value: realSpawn });
  syncBuiltinESMExports();
  discoveryDescendantStarted = await access(descendantMarker).then(() => true, () => false);
  await rm(authDirectory, { recursive: true, force: true });
}

const schemaRemoved = schemaPath === undefined || await access(path.dirname(schemaPath)).then(
  () => false,
  (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
);
process.stdout.write(JSON.stringify({
  ...result, cliStarted: cli !== null, schemaRemoved,
  ...(probe.discoveryFault === undefined ? {} : { discoveryDescendantStarted }),
} satisfies ProbeOutput));
