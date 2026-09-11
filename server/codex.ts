// AI-assisted nutrition-label extraction. Each request runs one ephemeral,
// tool-free Codex turn with a local image attachment and structured output.

import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import path from 'node:path';
import { MAX_PRODUCT_KCAL_PER100, MAX_PRODUCT_MACRO_GRAMS_PER100 } from '../shared/constraints.js';
import { runCodexJsonTurn } from './codex-runner.js';
import { log } from './log.js';
import type {
  CodexInput,
  CodexJsonTurn,
  ExtractedLabel,
  RawExtraction,
  RawPer100,
  SupportedImageMediaType,
} from './types.js';

export class InvalidExtractionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidExtractionError';
  }
}

const EXTRACTION_MODEL = 'gpt-5.6-terra';
const PROBE_MODEL = 'gpt-5.6-luna';
const EXTRACTION_TIMEOUT_MS = 80_000;
const PROBE_TIMEOUT_MS = 30_000;
const TEMP_WORKDIR_PREFIX = path.join(os.tmpdir(), 'kcal-codex-');

const SYSTEM_PROMPT = `You extract nutrition facts from a food label image. Rules:
- Output ONE JSON object, nothing else. No markdown, no prose, no code fences.
- Inspect the attached image directly. Do not use tools.
- Use ONLY the per-100g (or per-100ml) column. Ignore per-serving columns entirely.
- Prefer kcal over kJ. If only kJ is shown, compute kcal = round(kJ / 4.184).
- "unit" is "g" for solids, "ml" for liquids.
- "name" is the product's name as printed.
- "brand" is the manufacturer/brand if clearly printed; else null.
- If a macro is genuinely unreadable, set that number to null. Do not guess.
- If you can't read kcal at all, set kcal to null.`;

const NULLABLE_STRING_SCHEMA = {
  anyOf: [{ type: 'string' }, { type: 'null' }],
};

const NULLABLE_NUMBER_SCHEMA = {
  anyOf: [{ type: 'number' }, { type: 'null' }],
};

const EXTRACTION_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    name: NULLABLE_STRING_SCHEMA,
    brand: NULLABLE_STRING_SCHEMA,
    unit: { type: 'string', enum: ['g', 'ml'] },
    per100: {
      type: 'object',
      properties: {
        kcal: NULLABLE_NUMBER_SCHEMA,
        protein: NULLABLE_NUMBER_SCHEMA,
        carbs: NULLABLE_NUMBER_SCHEMA,
        fat: NULLABLE_NUMBER_SCHEMA,
      },
      required: ['kcal', 'protein', 'carbs', 'fat'],
      additionalProperties: false,
    },
  },
  required: ['name', 'brand', 'unit', 'per100'],
  additionalProperties: false,
};

const PROBE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok'] },
  },
  required: ['status'],
  additionalProperties: false,
};

const SUPPORTED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const IMAGE_EXTENSIONS: Record<SupportedImageMediaType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function normalizeMediaType(raw: string): SupportedImageMediaType {
  const base = raw.split(';')[0]!.trim().toLowerCase();
  const mapped = base === 'image/jpg' ? 'image/jpeg' : base;
  if (SUPPORTED_MIME_TYPES.has(mapped)) {
    return mapped as SupportedImageMediaType;
  }
  // Preserve the old fallback for unusual phone-camera MIME declarations.
  return 'image/jpeg';
}

function usageCtx(turn: CodexJsonTurn): Record<string, unknown> {
  if (turn.usage === null) return { threadId: turn.threadId };
  return {
    threadId: turn.threadId,
    input_tokens: turn.usage.input_tokens,
    cached_input_tokens: turn.usage.cached_input_tokens,
    output_tokens: turn.usage.output_tokens,
    reasoning_output_tokens: turn.usage.reasoning_output_tokens,
  };
}

async function withTempWorkdir<T>(action: (workDir: string) => Promise<T>): Promise<T> {
  const workDir = await fsp.mkdtemp(TEMP_WORKDIR_PREFIX);
  try {
    return await action(workDir);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch((err: unknown) => {
      log.warn('codex temp cleanup failed', {
        workDir,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

function stripCodeFences(text: string): string {
  let stripped = text.trim();
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json|JSON)?\s*/, '');
    stripped = stripped.replace(/\s*```$/, '');
  }
  return stripped.trim();
}

function parseJson(text: string): unknown {
  return JSON.parse(stripCodeFences(text)) as unknown;
}

function coerceNonNegMacro(value: unknown, cap: number): number | null {
  if (value === null || value === undefined) return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0 || numberValue > cap) return null;
  return numberValue;
}

// Null/undefined -> 0. Valid value -> coerced. Present-but-out-of-range -> throw.
function coerceOptionalMacro(value: unknown, cap: number, label: string): number {
  if (value === null || value === undefined) return 0;
  const numberValue = coerceNonNegMacro(value, cap);
  if (numberValue === null) throw new InvalidExtractionError(`${label}_out_of_range`);
  return numberValue;
}

function validateAndCoerce(parsed: unknown): ExtractedLabel {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidExtractionError('not_object');
  }
  const root = parsed as RawExtraction;
  const unit: 'g' | 'ml' = root.unit === 'ml' ? 'ml' : 'g';

  if (typeof root.per100 !== 'object' || root.per100 === null) {
    throw new InvalidExtractionError('per100_missing');
  }
  const per100Raw = root.per100 as RawPer100;

  const kcal = coerceNonNegMacro(per100Raw.kcal, MAX_PRODUCT_KCAL_PER100);
  if (kcal === null) throw new InvalidExtractionError('kcal_missing');

  const protein = coerceOptionalMacro(per100Raw.protein, MAX_PRODUCT_MACRO_GRAMS_PER100, 'protein');
  const carbs = coerceOptionalMacro(per100Raw.carbs, MAX_PRODUCT_MACRO_GRAMS_PER100, 'carbs');
  const fat = coerceOptionalMacro(per100Raw.fat, MAX_PRODUCT_MACRO_GRAMS_PER100, 'fat');
  const name = typeof root.name === 'string' ? root.name.trim() : '';

  let brand: string | null = null;
  if (typeof root.brand === 'string') {
    const trimmed = root.brand.trim();
    brand = trimmed === '' ? null : trimmed;
  }

  return {
    name,
    brand,
    unit,
    per100: { kcal, protein, carbs, fat },
  };
}

// Verifies that the local Codex CLI can start and use the persisted service-
// account authentication. Failure is logged but never prevents the server from
// accepting non-AI traffic.
export async function probeCodex(): Promise<void> {
  const startedAt = Date.now();
  log.info('codex probe start');
  try {
    const turn = await withTempWorkdir((workDir) =>
      runCodexJsonTurn('Return the JSON object {"status":"ok"}.', {
        model: PROBE_MODEL,
        modelReasoningEffort: 'low',
        workingDirectory: workDir,
        outputSchema: PROBE_OUTPUT_SCHEMA,
        timeoutMs: PROBE_TIMEOUT_MS,
      }),
    );
    const parsed = parseJson(turn.finalResponse);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as { status?: unknown }).status !== 'ok'
    ) {
      throw new Error('Codex probe returned an invalid response');
    }
    log.info('codex probe ok', {
      ms: Date.now() - startedAt,
      ...usageCtx(turn),
    });
  } catch (err) {
    log.error('codex probe failed', {
      ms: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function extractNutrition(
  image: Buffer,
  mimeType: string,
): Promise<ExtractedLabel> {
  const mediaType = normalizeMediaType(mimeType);
  const startedAt = Date.now();
  log.info('extraction start', {
    bytes: image.byteLength,
    mediaType,
  });

  const turn = await withTempWorkdir(async (workDir) => {
    const imagePath = path.join(workDir, `nutrition-label.${IMAGE_EXTENSIONS[mediaType]}`);
    await fsp.writeFile(imagePath, image);
    const input = [
      {
        type: 'text',
        text:
          `SYSTEM INSTRUCTIONS:\n${SYSTEM_PROMPT}\n\n` +
          'USER REQUEST:\nExtract the nutrition facts from the attached food label.',
      },
      { type: 'local_image', path: imagePath },
    ] satisfies CodexInput;

    return runCodexJsonTurn(input, {
      model: EXTRACTION_MODEL,
      modelReasoningEffort: 'medium',
      workingDirectory: workDir,
      outputSchema: EXTRACTION_OUTPUT_SCHEMA,
      timeoutMs: EXTRACTION_TIMEOUT_MS,
    });
  });

  log.info('extraction done', {
    ms: Date.now() - startedAt,
    ...usageCtx(turn),
  });

  let parsed: unknown;
  try {
    parsed = parseJson(turn.finalResponse);
  } catch {
    log.warn('extraction invalid', { reason: 'unparseable_json' });
    throw new InvalidExtractionError('unparseable_json');
  }

  try {
    return validateAndCoerce(parsed);
  } catch (err) {
    if (err instanceof InvalidExtractionError) {
      log.warn('extraction invalid', { reason: err.message });
    }
    throw err;
  }
}
