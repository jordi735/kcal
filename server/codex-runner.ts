// Shared one-turn Codex CLI runner for structured, tool-free server inference.
// Uses the repository-local CLI package, streams JSONL events, and leaves no
// persisted Codex session or temporary schema behind.

import { spawn, type ChildProcess } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import path from 'node:path';
import type {
  CodexInput,
  CodexJsonTurn,
  CodexRunOptions,
  CodexRunFiles,
  CodexThreadEvent,
  CodexUsage,
  NormalizedCodexInput,
} from './types.js';

const require = createRequire(import.meta.url);
const CODEX_CLI_JS = require.resolve('@openai/codex/bin/codex.js');
const TOOL_FREE_MODELS = ['gpt-5.6-terra', 'gpt-5.6-luna'] as const;
const SCHEMA_TEMP_PREFIX = path.join(os.tmpdir(), 'kcal-codex-schema-');
const STDIO_TAIL_CHARS = 4000;
const FORCE_KILL_DELAY_MS = 5000;
const MODEL_CATALOG_TIMEOUT_MS = 5000;
const MODEL_CATALOG_MAX_BYTES = 2 * 1024 * 1024;
let modelCatalogPromise: Promise<string> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function signalProcess(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && proc.pid !== undefined) {
    try {
      process.kill(-proc.pid, signal);
      return;
    } catch {
      // Fall through to signaling the Node child directly.
    }
  }
  proc.kill(signal);
}

async function readBundledModelCatalog(): Promise<string> {
  // --bundled skips refresh, auth and user config. Read the same installed CLI
  // that will run inference, retaining its prompts, image support and fast tier.
  const proc = spawn(process.execPath, [CODEX_CLI_JS, 'debug', 'models', '--bundled'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: process.env,
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  let failure: Error | null = null;
  const stop = (error: Error): void => {
    failure ??= error;
    signalProcess(proc, 'SIGKILL');
  };
  const timeout = setTimeout(() => {
    stop(new Error(`Codex model catalog timed out after ${MODEL_CATALOG_TIMEOUT_MS}ms`));
  }, MODEL_CATALOG_TIMEOUT_MS);
  const consume = (chunk: Buffer, keep: boolean): void => {
    if (failure !== null) return;
    bytes += chunk.length;
    if (bytes > MODEL_CATALOG_MAX_BYTES) {
      stop(new Error(`Codex model catalog exceeded ${MODEL_CATALOG_MAX_BYTES} bytes`));
    } else if (keep) {
      chunks.push(chunk);
    }
  };
  proc.stdout!.on('data', (chunk: Buffer) => consume(chunk, true));
  proc.stderr!.on('data', (chunk: Buffer) => consume(chunk, false));
  try {
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      proc.once('error', reject);
      proc.once('close', (code, signal) => resolve({ code, signal }));
    });
    if (failure !== null) throw failure;
    if (exit.code !== 0 || exit.signal !== null) {
      throw new Error(`Codex model catalog exited with ${exit.signal ?? `code ${exit.code ?? 1}`}`);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    clearTimeout(timeout);
    proc.removeAllListeners();
    proc.stdout?.removeAllListeners();
    proc.stderr?.removeAllListeners();
  }
}

async function readToolFreeModelCatalog(): Promise<string> {
  const stdout = await readBundledModelCatalog();
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) {
    throw new Error('Invalid bundled Codex model catalog');
  }
  const entries: unknown[] = parsed.models;
  const models = TOOL_FREE_MODELS.map((slug) => {
    const matches = entries.filter((entry) => isRecord(entry) && entry.slug === slug);
    const model = matches[0];
    if (matches.length !== 1 || !isRecord(model)
      || typeof model.base_instructions !== 'string' || model.base_instructions.length === 0
      || !Array.isArray(model.input_modalities) || !model.input_modalities.includes('text')
      || !model.input_modalities.includes('image')
      || !Array.isArray(model.experimental_supported_tools) || model.experimental_supported_tools.length !== 0
      || ![null, 'direct', 'code_mode', 'code_mode_only'].includes(model.tool_mode as string | null)
      || !(model.apply_patch_tool_type === null || typeof model.apply_patch_tool_type === 'string')
      || ![null, 'v1', 'v2'].includes(model.multi_agent_version as string | null)) {
      throw new Error(`Unsupported bundled Codex model metadata: ${slug}`);
    }
    // Model defaults can force Code Mode and apply_patch despite feature flags.
    // Change only those two tool settings; the rest remains the shipped catalog.
    return { ...model, tool_mode: 'direct', apply_patch_tool_type: null };
  });
  return JSON.stringify({ models });
}

function getToolFreeModelCatalog(): Promise<string> {
  modelCatalogPromise ??= readToolFreeModelCatalog().catch((error: unknown) => {
    modelCatalogPromise = null;
    throw error;
  });
  return modelCatalogPromise;
}

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

async function createRunFiles(schema: object, modelCatalog: string): Promise<CodexRunFiles> {
  const dir = await fsp.mkdtemp(SCHEMA_TEMP_PREFIX);
  const schemaPath = path.join(dir, 'schema.json');
  const modelCatalogPath = path.join(dir, 'models.json');
  try {
    await fsp.writeFile(schemaPath, JSON.stringify(schema), 'utf8');
    await fsp.writeFile(modelCatalogPath, modelCatalog, 'utf8');
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    schemaPath,
    modelCatalogPath,
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
  files: CodexRunFiles,
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
    '--output-schema', files.schemaPath,
    '--config', `model_catalog_json=${JSON.stringify(files.modelCatalogPath)}`,
    '--config', 'approval_policy="never"',
    '--config', 'service_tier="fast"',
    '--config', 'features.fast_mode=true',
    '--config', `model_reasoning_effort="${options.modelReasoningEffort}"`,
    '--config', 'web_search="disabled"',
    '--config', 'project_doc_max_bytes=0',
    '--config', 'shell_environment_policy.inherit="none"',
    '--config', 'agents.enabled=false',
    '--config', 'tools.experimental_request_user_input.enabled=false',
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
    '--disable', 'multi_agent_v2',
    '--disable', 'plugins',
    '--disable', 'remote_plugin',
    '--disable', 'shell_tool',
    '--disable', 'sleep_tool',
    '--disable', 'view_image',
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
  if (!TOOL_FREE_MODELS.some((model) => model === options.model)) {
    throw new Error(`Unsupported tool-free Codex model: ${options.model}`);
  }
  const modelCatalog = await getToolFreeModelCatalog();
  const normalized = normalizeInput(input);
  const files = await createRunFiles(options.outputSchema, modelCatalog);

  try {
    const args = buildArgs(normalized, options, files);
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

    const stopForTimeout = (): void => {
      if (timedOut) return;
      timedOut = true;
      signalProcess(proc, 'SIGTERM');
      forceKillTimer = setTimeout(() => signalProcess(proc, 'SIGKILL'), FORCE_KILL_DELAY_MS);
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
    await files.cleanup();
  }
}
