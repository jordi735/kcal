// AI-assisted nutrition-label extraction. One-shot call to the Claude Agent
// SDK with the label image; returns a strictly-validated ExtractedLabel.
//
// The SDK wraps the Claude Code binary as a subprocess; we disable every
// built-in tool + isolate from filesystem settings so the model is forced
// into pure vision-to-JSON inference.

import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { log } from './log.js';
import type {
  Base64ImageMediaType,
  ExtractedLabel,
  RawExtraction,
  RawPer100,
} from './types.js';

export class InvalidExtractionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidExtractionError';
  }
}

function buildUsageCtx(messages: SDKMessage[]): Record<string, unknown> {
  const r = messages.find(
    (m): m is Extract<SDKMessage, { type: 'result' }> => m.type === 'result',
  );
  return r === undefined
    ? {}
    : {
        cost_usd: r.total_cost_usd,
        input_tokens: r.usage.input_tokens,
        output_tokens: r.usage.output_tokens,
      };
}

const SYSTEM_PROMPT = `You extract nutrition facts from a food label image. Rules:
- Output ONE JSON object, nothing else. No markdown, no prose, no code fences.
- Use ONLY the per-100g (or per-100ml) column. Ignore per-serving columns entirely.
- Prefer kcal over kJ. If only kJ is shown, compute kcal = round(kJ / 4.184).
- "unit" is "g" for solids, "ml" for liquids.
- "name" is the product's name as printed, in Title Case (e.g. "Peanut Butter").
- "brand" is the manufacturer/brand if clearly printed; else null.
- If a macro is genuinely unreadable, set that number to null. Do not guess.
- If you can't read kcal at all, set kcal to null.
Schema:
{
  "name": string | null,
  "brand": string | null,
  "unit": "g" | "ml",
  "per100": {
    "kcal": number | null,
    "protein": number | null,
    "carbs": number | null,
    "fat": number | null
  }
}`;

const SUPPORTED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

function normalizeMediaType(raw: string): Base64ImageMediaType {
  // Strip any `; charset=` suffix and normalize `image/jpg` → `image/jpeg`.
  const base = raw.split(';')[0]!.trim().toLowerCase();
  const mapped = base === 'image/jpg' ? 'image/jpeg' : base;
  if (SUPPORTED_MIME_TYPES.has(mapped)) {
    return mapped as Base64ImageMediaType;
  }
  // Fallback: most phone cameras use JPEG. A lie here leads to API rejection,
  // which bubbles up as a 500 to the client — acceptable for our scale.
  return 'image/jpeg';
}

async function* userMessageStream(
  imageBase64: string,
  mediaType: Base64ImageMediaType,
): AsyncGenerator<SDKUserMessage, void, void> {
  yield {
    type: 'user',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType,
            data: imageBase64,
          },
        },
        {
          type: 'text',
          text: 'Extract nutrition from this label.',
        },
      ],
    },
  };
}

function stripCodeFences(text: string): string {
  let s = text.trim();
  if (s.startsWith('```')) {
    // Strip the opening fence (optionally with a language tag) and the
    // closing fence.
    s = s.replace(/^```(?:json|JSON)?\s*/, '');
    s = s.replace(/\s*```$/, '');
  }
  return s.trim();
}

function coerceNonNegMacro(v: unknown, cap: number): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > cap) return null;
  return n;
}

// Null/undefined → 0. Valid value → coerced. Present-but-out-of-range → throw.
function coerceOptionalMacro(v: unknown, cap: number, label: string): number {
  if (v === null || v === undefined) return 0;
  const n = coerceNonNegMacro(v, cap);
  if (n === null) throw new InvalidExtractionError(`${label}_out_of_range`);
  return n;
}

function validateAndCoerce(parsed: unknown): ExtractedLabel {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidExtractionError('not_object');
  }
  const root = parsed as RawExtraction;

  // unit: default to 'g' when null/missing/invalid.
  const unit: 'g' | 'ml' = root.unit === 'ml' ? 'ml' : 'g';

  // per100 must be an object.
  if (typeof root.per100 !== 'object' || root.per100 === null) {
    throw new InvalidExtractionError('per100_missing');
  }
  const per100Raw = root.per100 as RawPer100;

  const kcal = coerceNonNegMacro(per100Raw.kcal, 2000);
  if (kcal === null) throw new InvalidExtractionError('kcal_missing');

  const protein = coerceOptionalMacro(per100Raw.protein, 200, 'protein');
  const carbs = coerceOptionalMacro(per100Raw.carbs, 200, 'carbs');
  const fat = coerceOptionalMacro(per100Raw.fat, 200, 'fat');

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

function extractResultText(messages: SDKMessage[]): string {
  // Prefer the structured `result` success message.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.type === 'result' && msg.subtype === 'success') {
      return msg.result;
    }
  }
  // Fall back to the last assistant text block if the SDK didn't emit a
  // success result (e.g. error_during_execution still streams an assistant
  // turn). Errors outside that path are caller-visible via the result
  // message above.
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text') return block.text;
      }
    }
  }
  throw new InvalidExtractionError('no_assistant_output');
}

// Startup smoke test: fires a single Haiku turn asking Claude to say "OK".
// Verifies the SDK can spawn the `claude` subprocess and reach the API.
// Errors are swallowed and logged — a failing probe must not crash the server.
export async function probeClaude(): Promise<void> {
  const startedAt = Date.now();
  log.info('claude probe start');
  try {
    const response = query({
      prompt: 'Say OK and nothing else.',
      options: {
        model: 'haiku',
        tools: [],
        allowedTools: [],
        settingSources: [],
        permissionMode: 'dontAsk',
        maxTurns: 1,
        persistSession: false,
        includePartialMessages: false,
      },
    });

    const messages: SDKMessage[] = [];
    for await (const msg of response) {
      messages.push(msg);
    }

    const text = extractResultText(messages).trim();
    log.info('claude probe ok', {
      ms: Date.now() - startedAt,
      response: text,
      ...buildUsageCtx(messages),
    });
  } catch (err) {
    log.error('claude probe failed', {
      ms: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function extractNutrition(
  imageBase64: string,
  mimeType: string,
): Promise<ExtractedLabel> {
  const mediaType = normalizeMediaType(mimeType);
  const startedAt = Date.now();
  log.info('extraction start', {
    bytes: imageBase64.length,
    mediaType,
  });

  const response = query({
    prompt: userMessageStream(imageBase64, mediaType),
    options: {
      model: 'claude-sonnet-4-6',
      fallbackModel: 'claude-opus-4-7',
      systemPrompt: SYSTEM_PROMPT,
      tools: [],
      allowedTools: [],
      settingSources: [],
      permissionMode: 'dontAsk',
      maxTurns: 1,
      persistSession: false,
      includePartialMessages: false,
    },
  });

  const messages: SDKMessage[] = [];
  for await (const msg of response) {
    messages.push(msg);
  }

  log.info('extraction done', {
    ms: Date.now() - startedAt,
    ...buildUsageCtx(messages),
  });

  const text = extractResultText(messages);
  const stripped = stripCodeFences(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
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
