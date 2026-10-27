import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { JSONReportSpec } from '@playwright/test/reporter';

type ListedTest = Pick<JSONReportSpec, 'title' | 'file' | 'line'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Validate the fields used here instead of assuming every parsed JSON value is
// a Playwright report. Discovery errors must never look like an empty catalog.
function listedTests(report: unknown, errors: string[]): ListedTest[] {
  const tests: ListedTest[] = [];
  if (!isRecord(report) || !Array.isArray(report.errors)) {
    errors.push('Malformed Playwright discovery report: expected an errors array.');
    return tests;
  }
  for (const error of report.errors) {
    const message = isRecord(error) && typeof error.message === 'string'
      ? error.message : JSON.stringify(error);
    errors.push(`Playwright discovery error: ${message}`);
  }

  function visit(suites: unknown, location: string): void {
    if (!Array.isArray(suites)) {
      errors.push(`Malformed Playwright discovery report: ${location} must be an array.`);
      return;
    }
    for (const [index, suite] of suites.entries()) {
      const suiteLocation = `${location}[${index}]`;
      if (!isRecord(suite) || !Array.isArray(suite.specs)) {
        errors.push(`Malformed Playwright discovery report: ${suiteLocation}.specs must be an array.`);
        continue;
      }
      for (const [specIndex, spec] of suite.specs.entries()) {
        if (!isRecord(spec) || typeof spec.title !== 'string'
          || typeof spec.file !== 'string' || spec.file.length === 0
          || typeof spec.line !== 'number' || !Number.isInteger(spec.line) || spec.line < 1) {
          errors.push(`Malformed Playwright discovery report: ${suiteLocation}.specs[${specIndex}] needs a title, file, and line.`);
          continue;
        }
        tests.push({ title: spec.title, file: spec.file, line: spec.line });
      }
      if (suite.suites !== undefined) visit(suite.suites, `${suiteLocation}.suites`);
    }
  }
  visit(report.suites, 'suites');
  return tests;
}

export function validateJourneyCatalog(catalog: string, report: unknown): string[] {
  const errors: string[] = [];
  const catalogIds = new Map<string, number>();
  // Ignore examples and comments, preserving line numbers for diagnostics.
  const lines = catalog.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\n]/g, '')).split(/\r?\n/);
  let fence: string | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined || !line.startsWith('- J-')) continue;
    const match = /^- (J-\d{3,}) · (\S.*)$/.exec(line);
    const id = match?.[1];
    if (id === undefined) {
      errors.push(`tests/JOURNEYS.md:${index + 1}: expected "- J-### · description".`);
      continue;
    }
    const previous = catalogIds.get(id);
    if (previous !== undefined) {
      errors.push(`tests/JOURNEYS.md:${index + 1}: duplicate ${id} (first declared on line ${previous}).`);
    } else {
      catalogIds.set(id, index + 1);
    }
  }
  if (catalogIds.size === 0) errors.push('The journey catalog has no entries.');

  const tests = listedTests(report, errors);
  if (tests.length === 0) errors.push('Playwright discovered no tests.');
  const testIds = new Set<string>();
  for (const test of tests) {
    const id = /^\[(J-\d{3,})\]\s+\S/.exec(test.title)?.[1];
    if (id === undefined) {
      errors.push(`${test.file}:${test.line}: test title must start with "[J-###] description": ${JSON.stringify(test.title)}.`);
      continue;
    }
    testIds.add(id);
    if (!catalogIds.has(id)) errors.push(`${test.file}:${test.line}: ${id} has no catalog entry.`);
  }
  for (const [id, line] of catalogIds) {
    if (!testIds.has(id)) errors.push(`tests/JOURNEYS.md:${line}: ${id} has no discovered test title.`);
  }
  return errors;
}

function checkJourneys(): void {
  const require = createRequire(import.meta.url);
  const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...process.env };
  for (const key of ['PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR', 'PLAYWRIGHT_JSON_OUTPUT_NAME']) {
    delete env[key];
  }
  // --list expands parameterized titles without starting the server, running
  // setup tests, or clearing Playwright's output directory.
  const child = spawnSync(process.execPath, [
    require.resolve('@playwright/test/cli'), 'test', '--list', '--reporter=json',
  ], { cwd: repositoryRoot, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  if (child.error !== undefined) throw new Error('Could not discover Playwright tests.', { cause: child.error });

  let report: unknown;
  try {
    report = JSON.parse(child.stdout);
  } catch (error) {
    throw new Error(`Playwright discovery did not return valid JSON.\n${child.stderr.trim()}`, { cause: error });
  }
  const catalog = readFileSync(new URL('../tests/JOURNEYS.md', import.meta.url), 'utf8');
  const errors = validateJourneyCatalog(catalog, report);
  if (child.status !== 0) {
    errors.unshift(`Playwright discovery failed (exit ${child.status}, signal ${child.signal}).`);
    if (child.stderr.trim()) errors.push(child.stderr.trim());
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  console.log('Journey catalog matches all discovered test titles.');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkJourneys();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
