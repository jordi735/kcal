import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProbeInput, ProbeOutput } from './codex-runner-probe';

const SCHEMA = {
  type: 'object',
  properties: { status: { type: 'string', enum: ['ok'] } },
  required: ['status'],
  additionalProperties: false,
};
const FINAL_RESPONSE = '{"status":"ok"}';

function runProbe(input: ProbeInput): Promise<ProbeOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [
      '--import', 'tsx', fileURLToPath(new URL('./codex-runner-probe.ts', import.meta.url)),
    ], {
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Runner probe failed: ${error.message}\n${stderr}`));
        return;
      }
      try { resolve(JSON.parse(stdout) as ProbeOutput); }
      catch (parseError) { reject(parseError); }
    });
    child.stdin!.end(JSON.stringify(input));
  });
}

test('[J-255] the installed Codex CLI keeps runner requests tool-free and preserves results, failures, and timeouts', async () => {
  test.setTimeout(45_000);
  const workdir = await mkdtemp(path.join(tmpdir(), 'kcal-runner-test-'));
  const imagePath = path.join(workdir, 'label.png');
  await copyFile(new URL('../../public/favicon.png', import.meta.url), imagePath);
  let mode: 'success' | 'error' | 'hang' = 'success';
  const requests: { authorized: boolean; body: Record<string, unknown> }[] = [];
  const serverErrors: string[] = [];
  let hangingConnectionClosed = false;
  const server = createServer(async (request, response) => {
    // No remote catalog or real provider is consulted: the CLI uses locally
    // resolved model metadata. This does not verify live model availability.
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        authorized: request.headers.authorization !== undefined,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      if (mode === 'hang') {
        response.on('close', () => { hangingConnectionClosed = true; });
        return;
      }
      if (mode === 'error') {
        response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          error: { message: 'Deliberate offline provider failure', type: 'invalid_request_error' },
        }));
        return;
      }

      const item = {
        id: 'msg_offline', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: FINAL_RESPONSE, annotations: [] }],
      };
      const events = [
        { type: 'response.created', response: { id: 'resp_offline', status: 'in_progress' } },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: {
          id: 'resp_offline', status: 'completed', output: [item],
          usage: {
            input_tokens: 20, output_tokens: 8, total_tokens: 28,
            input_tokens_details: { cached_tokens: 5 },
            output_tokens_details: { reasoning_tokens: 3 },
          },
        } },
      ];
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    } catch (error) {
      serverErrors.push(error instanceof Error ? error.message : String(error));
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing fixture server port');

  const probe: ProbeInput = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    input: [{ type: 'text', text: 'Return the JSON object {"status":"ok"}.' }, { type: 'local_image', path: imagePath }],
    options: {
      model: 'gpt-5.6-terra', modelReasoningEffort: 'medium', workingDirectory: workdir,
      outputSchema: SCHEMA, timeoutMs: 8_000,
    },
  };

  try {
    for (const [model, modelReasoningEffort] of [['gpt-5.6-terra', 'medium'], ['gpt-5.6-luna', 'low']] as const) {
      await test.step(`${model} real CLI request and JSONL response`, async () => {
        const hasImage = model === 'gpt-5.6-terra';
        const result = await runProbe({
          ...probe,
          input: hasImage ? probe.input : 'Return the JSON object {"status":"ok"}.',
          options: { ...probe.options, model, modelReasoningEffort },
        });
        expect(result).toMatchObject({ ok: true, cliStarted: true, schemaRemoved: true });
        if (!result.ok) throw new Error(result.error);
        expect(result.turn.finalResponse).toBe(FINAL_RESPONSE);
        expect(result.turn.threadId).toMatch(/^[0-9a-f-]{36}$/);
        expect(result.turn.usage).toMatchObject({
          input_tokens: 20, cached_input_tokens: 5, output_tokens: 8, reasoning_output_tokens: 3,
        });
        expect(requests).toHaveLength(hasImage ? 1 : 2);
        const request = requests.at(-1)!;
        expect(request.authorized).toBe(false);
        expect(request.body.model).toBe(model);
        expect(request.body.service_tier).toBe('priority');
        expect(request.body.reasoning).toMatchObject({ effort: modelReasoningEffort });
        expect(request.body.text).toMatchObject({
          verbosity: 'low', format: { type: 'json_schema', strict: true, schema: SCHEMA },
        });
        // Codex can put tools in top-level Responses tools or developer input
        // items. An absent top-level tools field alone does not mean tool-free.
        const input = request.body.input as Record<string, unknown>[];
        const toolSets = [request.body.tools, ...input.map((item) => item.tools)];
        const exposedTools = toolSets.flatMap((tools) => {
          if (tools === undefined) return [];
          if (!Array.isArray(tools)) return ['Unrecognized tool list'];
          return tools.map((tool: { type?: string; name?: string }) => `${tool.type ?? 'unknown'}:${tool.name ?? 'unnamed'}`);
        });
        expect(exposedTools).toEqual([]);
        const images = input.flatMap((item) => Array.isArray(item.content)
          ? item.content.filter((content: { type?: string }) => content.type === 'input_image') : []);
        if (hasImage) expect(images).toMatchObject([{ image_url: expect.stringMatching(/^data:image\/png;base64,/) }]);
        else expect(images).toEqual([]);
      });
    }

    await test.step('provider failure is not accepted as a successful turn', async () => {
      mode = 'error';
      const result = await runProbe(probe);
      expect(result).toMatchObject({ ok: false, cliStarted: true, schemaRemoved: true });
      if (result.ok) throw new Error('Provider failure unexpectedly succeeded');
      expect(result.error).toContain('Codex exited with code 1');
      expect(result.error).toContain('Deliberate offline provider failure');
      expect(requests).toHaveLength(3);
    });

    await test.step('timeout terminates the CLI and cleans its schema', async () => {
      mode = 'hang';
      const result = await runProbe({ ...probe, options: { ...probe.options, timeoutMs: 2_000 } });
      expect(result).toMatchObject({ ok: false, cliStarted: true, schemaRemoved: true });
      if (result.ok) throw new Error('Unfinished provider response unexpectedly succeeded');
      expect(result.error).toMatch(/^Codex timed out after 2000ms \(thread=[0-9a-f-]{36}\)$/);
      expect(requests).toHaveLength(4);
      await expect.poll(() => hangingConnectionClosed).toBe(true);
    });

    await test.step('unknown models fail before the CLI can fall back to tools', async () => {
      const result = await runProbe({ ...probe, options: { ...probe.options, model: 'unknown-future-model' } });
      expect(result).toEqual({
        ok: false, cliStarted: false, schemaRemoved: true,
        error: 'Unsupported tool-free Codex model: unknown-future-model',
      });
      expect(requests).toHaveLength(4);
    });

    for (const discoveryFault of ['timeout', 'output-limit'] as const) {
      await test.step(`metadata ${discoveryFault} stops descendants and never starts inference`, async () => {
        const result = await runProbe({ ...probe, discoveryFault });
        expect(result).toEqual({
          ok: false, cliStarted: false, schemaRemoved: true, discoveryDescendantStarted: true,
          error: discoveryFault === 'timeout'
            ? 'Codex model catalog timed out after 5000ms'
            : 'Codex model catalog exceeded 2097152 bytes',
        });
        expect(requests).toHaveLength(4);
      });
    }
    expect(serverErrors).toEqual([]);
    expect(await readdir(workdir)).toEqual(['label.png']);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(workdir, { recursive: true, force: true });
  }
});
