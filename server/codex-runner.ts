// Shared one-turn Codex CLI runner for structured, tool-free server inference.
// Uses the repository-local CLI package, streams JSONL events, and leaves no
// persisted Codex session or temporary schema behind.

import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import path from 'node:path';
import type {
  CodexInput,
  CodexJsonTurn,
  CodexRunOptions,
  CodexSchemaFile,
  CodexThreadEvent,
  CodexUsage,
  NormalizedCodexInput,
} from './types.js';

const require = createRequire(import.meta.url);
const CODEX_CLI_JS = require.resolve('@openai/codex/bin/codex.js');
const SCHEMA_TEMP_PREFIX = path.join(os.tmpdir(), 'kcal-codex-schema-');
const STDIO_TAIL_CHARS = 4000;
const FORCE_KILL_DELAY_MS = 5000;

function normalizeInput(input: CodexInput): NormalizedCodexInput {
  if (typeof input === 'string') {
    return { prompt: input, images: [] };
  }

  const promptParts: string[] = [];
  const images: string[] = [];
  for (const item of input) {
    if (item.type === 'text') {
      promptParts.push(item.text);
    } else {
      images.push(item.path);
    }
  }
  return { prompt: promptParts.join('\n\n'), images };
}

async function createSchemaFile(schema: object): Promise<CodexSchemaFile> {
  const dir = await fsp.mkdtemp(SCHEMA_TEMP_PREFIX);
  const schemaPath = path.join(dir, 'schema.json');
  await fsp.writeFile(schemaPath, JSON.stringify(schema), 'utf8');
  return {
    path: schemaPath,
    cleanup: () => fsp.rm(dir, { recursive: true, force: true }),
  };
}

function tail(existing: string, chunk: string): string {
  return (existing + chunk).slice(-STDIO_TAIL_CHARS);
}

function parseEvent(line: string): CodexThreadEvent | null {
  try {
    return JSON.parse(line) as CodexThreadEvent;
  } catch {
    return null;
  }
}

function buildArgs(
  input: NormalizedCodexInput,
  options: CodexRunOptions,
  schemaPath: string,
): string[] {
  const args = [
    'exec',
    '--json',
    '--color', 'never',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--skip-git-repo-check',
    '--model', options.model,
    '--sandbox', 'read-only',
    '--cd', options.workingDirectory,
    '--output-schema', schemaPath,
    '--config', 'approval_policy="never"',
    '--config', 'service_tier="fast"',
    '--config', 'features.fast_mode=true',
    '--config', `model_reasoning_effort="${options.modelReasoningEffort}"`,
    '--config', 'web_search="disabled"',
    '--config', 'project_doc_max_bytes=0',
    '--config', 'shell_environment_policy.inherit="none"',
    '--disable', 'apps',
    '--disable', 'browser_use',
    '--disable', 'browser_use_external',
    '--disable', 'browser_use_full_cdp_access',
    '--disable', 'computer_use',
    '--disable', 'goals',
    '--disable', 'hooks',
    '--disable', 'image_generation',
    '--disable', 'in_app_browser',
    '--disable', 'multi_agent',
    '--disable', 'plugins',
    '--disable', 'remote_plugin',
    '--disable', 'shell_tool',
  ];

  for (const image of input.images) {
    args.push('--image', image);
  }
  return args;
}

export async function runCodexJsonTurn(
  input: CodexInput,
  options: CodexRunOptions,
): Promise<CodexJsonTurn> {
  const normalized = normalizeInput(input);
  const schemaFile = await createSchemaFile(options.outputSchema);

  try {
    const args = buildArgs(normalized, options, schemaFile.path);
    let stdoutTail = '';
    let stderrTail = '';
    let pendingStdout = '';
    let threadId: string | null = null;
    let finalResponse = '';
    let usage: CodexUsage | null = null;
    let turnFailure: string | null = null;
    let streamError: string | null = null;
    let stdinError: string | null = null;
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let forceKillTimer: NodeJS.Timeout | null = null;

    const proc = spawn(process.execPath, [CODEX_CLI_JS, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: process.env,
    });

    const signalProcess = (signal: NodeJS.Signals): void => {
      if (process.platform !== 'win32' && proc.pid !== undefined) {
        try {
          process.kill(-proc.pid, signal);
          return;
        } catch {
          // Fall through to signaling the Node child directly.
        }
      }
      proc.kill(signal);
    };

    const stopForTimeout = (): void => {
      if (timedOut) return;
      timedOut = true;
      signalProcess('SIGTERM');
      forceKillTimer = setTimeout(() => signalProcess('SIGKILL'), FORCE_KILL_DELAY_MS);
    };

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed === '') return;
      const event = parseEvent(trimmed);
      if (event === null) return;

      if (event.type === 'thread.started') {
        threadId = event.thread_id;
      } else if (event.type === 'item.completed') {
        if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
          finalResponse = event.item.text;
        } else if (event.item.type === 'error' && typeof event.item.message === 'string') {
          streamError = event.item.message;
        }
      } else if (event.type === 'turn.completed') {
        usage = event.usage;
      } else if (event.type === 'turn.failed') {
        turnFailure = event.error.message;
      } else if (event.type === 'error') {
        streamError = event.message;
      }
    };

    const consumeStdout = (chunk: string): void => {
      stdoutTail = tail(stdoutTail, chunk);
      pendingStdout += chunk;
      let newlineIndex: number;
      while ((newlineIndex = pendingStdout.indexOf('\n')) !== -1) {
        const line = pendingStdout.slice(0, newlineIndex);
        pendingStdout = pendingStdout.slice(newlineIndex + 1);
        handleLine(line);
      }
    };

    timeoutTimer = setTimeout(stopForTimeout, options.timeoutMs);

    try {
      proc.stdout!.setEncoding('utf8');
      proc.stdout!.on('data', consumeStdout);
      proc.stderr!.setEncoding('utf8');
      proc.stderr!.on('data', (chunk: string) => {
        stderrTail = tail(stderrTail, chunk);
      });
      proc.stdin!.on('error', (err: Error) => {
        stdinError = err.message;
      });
      proc.stdin!.end(normalized.prompt);

      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
          proc.once('error', reject);
          proc.once('close', (code, signal) => resolve({ code, signal }));
        },
      );

      if (pendingStdout.trim() !== '') {
        handleLine(pendingStdout);
      }
      if (timedOut) {
        throw new Error(`Codex timed out after ${options.timeoutMs}ms (thread=${threadId ?? 'none'})`);
      }
      if (exit.code !== 0 || exit.signal !== null) {
        const detail = exit.signal === null ? `code ${exit.code ?? 1}` : `signal ${exit.signal}`;
        throw new Error(
          `Codex exited with ${detail} (thread=${threadId ?? 'none'}) | stderr: ${stderrTail.trim()} | stdout: ${stdoutTail.trim()}`,
        );
      }
      if (streamError !== null) throw new Error(streamError);
      if (turnFailure !== null) throw new Error(turnFailure);
      if (stdinError !== null) throw new Error(`Codex stdin failed: ${stdinError}`);
      if (threadId === null) throw new Error('Codex did not emit thread.started event');
      if (finalResponse === '') throw new Error(`Codex returned an empty response (thread=${threadId})`);

      return { finalResponse, threadId, usage };
    } finally {
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      proc.removeAllListeners();
      proc.stdin?.removeAllListeners();
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
    }
  } finally {
    await schemaFile.cleanup();
  }
}
