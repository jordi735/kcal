import { expect, test } from '@playwright/test';
import { validateJourneyCatalog } from '../../scripts/check-journeys';

function report(...titles: string[]) {
  return {
    errors: [],
    suites: [{ specs: titles.map((title, index) => ({ title, file: 'example.spec.ts', line: index + 1 })) }],
  };
}

test('[J-496] journey catalog checks discovered titles and rejects missing duplicate or malformed coverage', () => {
  const catalog = '- J-001 · Sign in\n- J-002 · Parameterized journey';
  const discovered = report('[J-001] user A signs in', '[J-001] user B signs in');
  const nested = {
    errors: [],
    suites: [{ specs: [], suites: [...discovered.suites, ...report('[J-002] expanded parameter').suites] }],
  };
  expect(validateJourneyCatalog(catalog, nested)).toEqual([]);

  const examples = `${catalog}\nProse mentions J-900.\n<!--\n- J-901 · Comment only\n-->\n\`\`\`text\n- J-902 · Example only\n\`\`\``;
  expect(validateJourneyCatalog(examples, nested)).toEqual([]);
  expect(validateJourneyCatalog('- J-1000 · Future ID', report('[J-1000] future journey'))).toEqual([]);

  expect(validateJourneyCatalog(`${catalog}\n- J-001 · Duplicate`, nested))
    .toContain('tests/JOURNEYS.md:3: duplicate J-001 (first declared on line 1).');
  expect(validateJourneyCatalog(catalog, report('[J-001] mentions J-002 only in prose')))
    .toContain('tests/JOURNEYS.md:2: J-002 has no discovered test title.');
  expect(validateJourneyCatalog('- J-001 · Sign in', report('[J-002] unknown journey')))
    .toContain('example.spec.ts:1: J-002 has no catalog entry.');
  for (const title of ['Missing prefix [J-001]', '[J-001]', '[J-001]   ', '[J-01] short ID']) {
    expect(validateJourneyCatalog('- J-001 · Sign in', report(title)))
      .toContain(`example.spec.ts:1: test title must start with "[J-###] description": ${JSON.stringify(title)}.`);
  }
  expect(validateJourneyCatalog('- J-001 · ', report('[J-001] sign in')))
    .toContain('tests/JOURNEYS.md:1: expected "- J-### · description".');
  expect(validateJourneyCatalog('Prose mentions J-001.', report('[J-001] sign in')))
    .toContain('The journey catalog has no entries.');
  expect(validateJourneyCatalog(catalog, { errors: [], suites: [] }))
    .toContain('Playwright discovered no tests.');
  expect(validateJourneyCatalog(catalog, { ...nested, errors: [{ message: 'Could not load a spec' }] }))
    .toContain('Playwright discovery error: Could not load a spec');
  expect(validateJourneyCatalog(catalog, null))
    .toContain('Malformed Playwright discovery report: expected an errors array.');
  expect(validateJourneyCatalog(catalog, { errors: [], suites: [{}] }))
    .toContain('Malformed Playwright discovery report: suites[0].specs must be an array.');
  expect(validateJourneyCatalog(catalog, { errors: [], suites: [{ specs: [{ title: '[J-001] missing location' }] }] }))
    .toContain('Malformed Playwright discovery report: suites[0].specs[0] needs a title, file, and line.');
});
