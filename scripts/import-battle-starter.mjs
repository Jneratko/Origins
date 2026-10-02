import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Bootstrap a small set of well-known events when the full SPARQL query times out.
const ids = ['Q48314', 'Q83224', 'Q33132', 'Q4087376'];
const url = new URL('https://www.wikidata.org/w/api.php');
for (const [key, value] of Object.entries({ action: 'wbgetentities', ids: ids.join('|'),
  props: 'labels|descriptions|claims|sitelinks', languages: 'en', format: 'json' })) url.searchParams.set(key, value);
const response = await fetch(url, { headers: {
  'User-Agent': 'OriginsBattleImporter/1.0 (https://github.com/Jneratko/Origins)'
}, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}; existing output unchanged.`);
const result = await response.json();
if (result.error) throw new Error(result.error.info);
const rows = [];
const best = statements => {
  const valid = (statements || []).filter(s => s.rank !== 'deprecated' && s.mainsnak?.snaktype === 'value');
  return valid.some(s => s.rank === 'preferred') ? valid.filter(s => s.rank === 'preferred') : valid;
};
const countryIds = [...new Set(Object.values(result.entities || {}).flatMap(entity =>
  best(entity.claims?.P17).map(s => s.mainsnak.datavalue.value.id)))];
const countryUrl = new URL('https://www.wikidata.org/w/api.php');
for (const [key, value] of Object.entries({ action: 'wbgetentities', ids: countryIds.join('|'),
  props: 'labels', languages: 'en', format: 'json' })) countryUrl.searchParams.set(key, value);
let labels = {};
if (countryIds.length) {
  const countryResponse = await fetch(countryUrl, { headers: {
    'User-Agent': 'OriginsBattleImporter/1.0 (https://github.com/Jneratko/Origins)'
  }, signal: AbortSignal.timeout(30000) });
  if (!countryResponse.ok) throw new Error(`Country labels HTTP ${countryResponse.status}`);
  labels = (await countryResponse.json()).entities || {};
}
for (const entity of Object.values(result.entities || {})) {
  const article = entity.sitelinks?.enwiki?.title;
  if (!article) continue;
  const property = best(entity.claims?.P585).length ? 'P585' : 'P580';
  const countries = best(entity.claims?.P17).map(s => s.mainsnak.datavalue.value.id);
  for (const coordinate of best(entity.claims?.P625)) {
    const point = coordinate.mainsnak.datavalue.value;
    if (!point.globe?.endsWith('/Q2')) continue;
    for (const statement of best(entity.claims?.[property])) {
      const date = statement.mainsnak.datavalue.value;
      for (const country of countries.length ? countries : [null]) rows.push({
        site: `http://www.wikidata.org/entity/${entity.id}`, siteLabel: entity.labels?.en?.value || entity.id,
        siteDescription: entity.descriptions?.en?.value || '', coordinates: `Point(${point.longitude} ${point.latitude})`,
        inceptionDate: date.time, datePrecision: String(date.precision), calendarModel: date.calendarmodel,
        dateProperty: property, article: `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, '_'))}`,
        ...(country ? { country: `http://www.wikidata.org/entity/${country}`, countryLabel: labels[country]?.labels?.en?.value || country } : {})
      });
    }
  }
}
const directory = await mkdtemp(join(tmpdir(), 'origins-battle-starter-'));
try {
  const input = join(directory, 'rows.json');
  await writeFile(input, JSON.stringify(rows));
  execFileSync(process.execPath, [new URL('./import-wikidata.mjs', import.meta.url).pathname, '--battles', input], { stdio: 'inherit' });
  const dataset = JSON.parse(await readFile('data/battles.json', 'utf8'));
  dataset.source = { ...dataset.source, type: 'wikidata-entity-api',
    endpoint: 'https://www.wikidata.org/w/api.php', fetchedAt: new Date().toISOString(),
    starterSet: true, requestedIds: ids };
  await writeFile('data/battles.json', JSON.stringify(dataset, null, 2) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }
