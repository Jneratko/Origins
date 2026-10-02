const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('importer preserves optional descriptions and deduplicates multiple countries in both export formats', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'origins-import-'));
  try {
    const base = { site: 'http://www.wikidata.org/entity/Q1', siteLabel: 'Example',
      coordinates: 'Point(1 2)', inceptionDate: '-9000-01-01T00:00:00Z', datePrecision: '9',
      calendarModel: 'http://www.wikidata.org/entity/Q1985727', article: 'https://en.wikipedia.org/wiki/Example' };
    const rows = [
      { ...base, siteDescription: 'Painted cave', country: 'http://www.wikidata.org/entity/Q29', countryLabel: 'Spain' },
      { ...base, country: 'http://www.wikidata.org/entity/Q142', countryLabel: 'France' },
      { ...base, country: 'http://www.wikidata.org/entity/Q29', countryLabel: 'Spain' },
      { ...base, site: 'http://www.wikidata.org/entity/Q2' }
    ];
    for (const raw of [rows, { results: { bindings: rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, { value }]))) } }]) {
      const input = path.join(directory, 'input.json');
      const output = path.join(directory, 'output.json');
      fs.writeFileSync(input, JSON.stringify(raw));
      const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/import-wikidata.mjs'), input, output], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const imported = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(imported.records.length, 2);
      assert.equal(imported.records[0].description, 'Painted cave');
      assert.deepEqual(imported.records[0].countries.map(c => c.title), ['Spain', 'France']);
      assert.equal(imported.records[0].inceptionDates.length, 1);
      assert.equal(imported.records[1].description, '');
      assert.deepEqual(imported.records[1].countries, []);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('battle importer writes event dates using P585 and P580 without archaeological inception dates', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'origins-battles-'));
  try {
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'battles.json');
    const base = { siteLabel: 'Battle', coordinates: 'Point(4 50)', inceptionDate: '1815-06-18T00:00:00Z',
      datePrecision: '11', calendarModel: 'http://www.wikidata.org/entity/Q1985727',
      article: 'https://en.wikipedia.org/wiki/Battle' };
    fs.writeFileSync(input, JSON.stringify(['P585', 'P580'].map((dateProperty, index) => ({
      ...base, site: `http://www.wikidata.org/entity/Q${index + 1}`, dateProperty
    }))));
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/import-wikidata.mjs'), '--battles', input, output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const imported = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(imported.source.category, 'Battles');
    assert.deepEqual(imported.records.map(r => r.eventDates[0].property), ['P585', 'P580']);
    assert.ok(imported.records.every(r => r.category === 'Battles' && !r.inceptionDates));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
