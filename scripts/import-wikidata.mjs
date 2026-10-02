import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Accept a Query Service download, or fetch the saved query directly.
const args = process.argv.slice(2);
const battles = args.includes('--battles');
const [input, output = battles ? 'data/battles.json' : 'data/candidates.json'] = args.filter(arg => arg !== '--battles');
const category = battles ? 'Battles' : 'Archaeology';
const dateField = battles ? 'eventDates' : 'inceptionDates';
if (!input) throw new Error('Usage: node scripts/import-wikidata.mjs [--battles] <input.json|--fetch> [output.json]');
let raw;
let source = { type: 'wikidata-query-export', property: battles ? 'P585/P580' : 'P571', category };
if (input === '--fetch') {
  const query = await readFile(new URL(battles ? './battles.sparql' : './archaeological-sites.sparql', import.meta.url), 'utf8');
  const endpoint = 'https://query.wikidata.org/sparql';
  const url = new URL(endpoint);
  url.searchParams.set('query', query);
  url.searchParams.set('format', 'json');
  console.log(`Fetching ${category.toLowerCase()} candidates from Wikidata…`);
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/sparql-results+json',
        'User-Agent': 'OriginsDatasetImporter/1.0 (https://github.com/Jneratko/Origins)'
      },
      signal: AbortSignal.timeout(55000)
    });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      throw new Error(`HTTP ${response.status}${retryAfter ? `; Retry-After: ${retryAfter}` : ''}`);
    }
    raw = await response.json();
  } catch (error) {
    throw new Error(`Wikidata fetch failed (${error.message}${error.cause?.code ? `: ${error.cause.code}` : ''}). Existing output was not changed. Retry later or import a downloaded JSON file.`, { cause: error });
  }
  source = { type: 'wikidata-query-service', property: battles ? 'P585/P580' : 'P571', category, endpoint,
    fetchedAt: new Date().toISOString(), query, rowLimit: 1000 };
} else {
  raw = JSON.parse((await readFile(resolve(input), 'utf8')).replace(/^\uFEFF/, ''));
}
const rows = Array.isArray(raw) ? raw : raw?.results?.bindings;
if (!Array.isArray(rows)) throw new Error('Expected a JSON array or SPARQL results.bindings.');
const value = cell => typeof cell === 'string' ? cell : cell?.value;
const precisionNames = ['billion years', 'hundred million years', 'ten million years', 'million years', 'hundred thousand years', 'ten thousand years', 'millennium', 'century', 'decade', 'year', 'month', 'day', 'hour', 'minute', 'second'];
const sites = new Map();
const rejectedRows = [];

for (const [index, row] of rows.entries()) {
  try {
    const siteUrl = value(row.site);
    const id = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/.exec(siteUrl)?.[1];
    const title = value(row.siteLabel);
    const point = /^Point\(\s*([-+\d.eE]+)\s+([-+\d.eE]+)\s*\)$/.exec(value(row.coordinates));
    const coordinates = point?.slice(1).map(Number);
    const date = value(row.inceptionDate);
    const dateProperty = battles ? value(row.dateProperty) : 'P571';
    if (battles && !['P585', 'P580'].includes(dateProperty)) throw new Error('Invalid battle date property.');
    const precision = Number(value(row.datePrecision));
    const calendarModel = value(row.calendarModel);
    const article = value(row.article);
    const description = value(row.siteDescription);
    const countryUrl = value(row.country);
    const countryId = /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/.exec(countryUrl)?.[1];
    const countryLabel = value(row.countryLabel);
    if (!id || !title) throw new Error('Missing valid Wikidata ID or title.');
    if (!coordinates || coordinates.some(n => !Number.isFinite(n)) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) throw new Error('Invalid coordinate point.');
    if (!/^[+-]?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date)) throw new Error('Invalid inception date.');
    if (value(row.datePrecision) === undefined || !Number.isInteger(precision) || precision < 0 || precision > 14) throw new Error('Invalid date precision.');
    if (!/^https?:\/\/www\.wikidata\.org\/entity\/Q\d+$/.test(calendarModel)) throw new Error('Missing calendar model.');
    if (!/^https:\/\/en\.wikipedia\.org\/wiki\/.+/.test(article)) throw new Error('Missing English Wikipedia article.');
    if (countryUrl !== undefined && !countryId) throw new Error('Invalid country entity.');
    if (!sites.has(id)) sites.set(id, {
      id, title, category, wikidataUrl: siteUrl, wikipediaUrls: [], coordinateCandidates: [],
      description: '', countries: [],
      [dateField]: [], reviewStatus: 'unreviewed', reviewFlags: ['date-meaning-unverified']
    });
    const site = sites.get(id);
    if (typeof description === 'string' && description.trim()) site.description = description.trim();
    if (countryId && !site.countries.some(c => c.id === countryId)) {
      site.countries.push({ id: countryId, title: countryLabel || countryId, wikidataUrl: countryUrl });
    }
    if (!site.wikipediaUrls.includes(article)) site.wikipediaUrls.push(article);
    if (!site.coordinateCandidates.some(p => p[0] === coordinates[0] && p[1] === coordinates[1])) site.coordinateCandidates.push(coordinates);
    const dateRecord = { value: date, precision, precisionLabel: precisionNames[precision], calendarModel, property: dateProperty };
    if (!site[dateField].some(d => JSON.stringify(d) === JSON.stringify(dateRecord))) site[dateField].push(dateRecord);
  } catch (error) {
    rejectedRows.push({ row: index + 1, reason: error.message });
  }
}

const records = [...sites.values()].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
for (const site of records) {
  if (site.coordinateCandidates.length > 1) site.reviewFlags.push('multiple-coordinates');
  if (site[dateField].length > 1) site.reviewFlags.push(battles ? 'multiple-event-dates' : 'multiple-inception-dates');
  if (site[dateField].some(d => d.precision < 9)) site.reviewFlags.push('coarse-date-precision');
}
const dataset = {
  schemaVersion: 1,
  source: { ...source, inputRows: rows.length,
    ...(input === '--fetch' ? { possiblyTruncated: rows.length >= source.rowLimit } : {}) },
  notes: ['Coordinates use [longitude, latitude].', battles ? 'Event dates use point in time (P585), falling back to start time (P580).' : 'Inception values are not verified construction or occupation dates.', 'Raw dates retain their calendar and precision; no timeline ages are inferred.', 'This export may be limited and is not an exhaustive archaeological inventory.'],
  rejectedRows, records
};
if (!records.length) throw new Error('No valid records; output was not written.');
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), JSON.stringify(dataset, null, 2) + '\n', 'utf8');
console.log(`Wrote ${records.length} sites from ${rows.length} rows to ${output}. Rejected: ${rejectedRows.length}.`);
if (dataset.source.possiblyTruncated) console.warn('Row limit reached. Results may be incomplete; increase the saved query limit or narrow the query.');
if (rejectedRows.length) process.exitCode = 1;
