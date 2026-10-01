const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/candidates.json'), 'utf8'));

class Element {
  constructor() { this.children = []; this.hidden = false; this.value = ''; this.attributes = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  style = {};
}

async function boot(input = dataset) {
  const elements = new Map();
  let map;
  const requests = [];
  const mapEvents = {};
  let tick;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    querySelectorAll: () => []
  };
  class MapStub {
    constructor() { map = this; this.sources = {}; this.layers = {}; this.filters = []; }
    addControl() {}
    on(name, layer, callback) { mapEvents[callback ? `${name}:${layer}` : name] = callback || layer; }
    addSource(id, source) { this.sources[id] = source; }
    addLayer(layer) { this.layers[layer.id] = layer; }
    getLayer(id) { return this.layers[id]; }
    setFilter(id, filter) { this.layers[id].filter = filter; this.filters.push(filter); }
    getCanvas() { return { style: {} }; }
    flyTo(value) { this.lastFlight = value; }
  }
  const context = vm.createContext({
    document, window: { maplibregl: { Map: MapStub, NavigationControl: class {} } },
    URL, localStorage: { getItem: () => null }, console,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => input }; },
    clearInterval: () => {}, setInterval: callback => { tick = callback; return 1; }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  if (mapEvents.load) mapEvents.load();
  return { context, elements, map, mapEvents, requests, tick: () => tick() };
}

test('imports unique sites, plots numeric locations, searches and displays source details', async () => {
  const app = await boot();
  const get = id => app.elements.get(id);
  assert.equal(app.requests[0].url, 'data/candidates.json');
  assert.equal(app.requests[0].options.cache, 'no-store');
  assert.ok(get('siteRows').children.length <= 11);
  assert.equal(get('count').textContent, `${dataset.records.length} / ${dataset.records.length}`);
  assert.equal(app.map.sources['atlas-sites'].data.features.length, dataset.records.length);
  assert.ok(app.map.sources['atlas-sites'].data.features.every(f => f.geometry.coordinates.every(Number.isFinite)));
  get('search').oninput({ target: { value: 'Altamira' } });
  assert.equal(get('siteRows').children.length, 1);
  get('siteRows').children[0].onclick();
  const detail = get('detail');
  assert.equal(detail.hidden, false);
  assert.ok(detail.children.some(e => e.textContent?.includes('millennium precision')));
  const links = detail.children.find(e => e.className === 'source-links');
  assert.equal(links.children.length, 2);
  assert.ok(links.children[0].href.startsWith('https://en.wikipedia.org/'));
  assert.ok(detail.children.some(e => e.textContent?.includes('recorded locations')));
});

test('timeline groups older than 10k and plays through the latest imported year', async () => {
  const fixture = { records: ['-9000', '-8050', '-1000', '0100'].map((year, index) => ({
    ...dataset.records[0], id: `Q${index + 1}`, title: `Fixture ${index}`,
    inceptionDates: [{ ...dataset.records[0].inceptionDates[0], value: `${year}-01-01T00:00:00Z` }]
  })) };
  const app = await boot(fixture);
  const get = id => app.elements.get(id);
  get('time').oninput({ target: { value: '10000' } });
  assert.equal(get('siteRows').children.length, 1);
  assert.equal(get('timeLabel').textContent, 'Older than 10k years');
  get('time').oninput({ target: { value: '1950' } });
  assert.equal(get('siteRows').children.length, 3);
  assert.equal(get('timeLabel').textContent, 'Year 0');
  get('alltime').onclick();
  assert.equal(get('siteRows').children.length, 4);
  get('play').onclick();
  assert.equal(get('play').attributes['aria-label'], 'Pause timeline');
  for (let i = 0; i < 60; i++) app.tick();
  assert.equal(get('siteRows').children.length, 4);
  assert.equal(get('timeLabel').textContent, '≈ 100 CE');
  assert.equal(get('play').textContent, '▶ Play');
  assert.equal(get('play').attributes['aria-label'], 'Play timeline');
  assert.equal(Number(get('time').value), Number(get('time').min));
});

test('selection preserves list buttons and the map source', async () => {
  const app = await boot();
  const buttons = [...app.elements.get('siteRows').children];
  const source = app.map.sources['atlas-sites'];
  buttons[0].onclick();
  assert.deepEqual(app.elements.get('siteRows').children, buttons);
  assert.equal(buttons[0].className, 'site active');
  app.mapEvents['click:atlas-sites']({ features: [{ properties: { siteId: buttons[1].atlasSiteId } }] });
  assert.equal(buttons[0].className, 'site');
  assert.equal(buttons[1].className, 'site active');
  assert.equal(app.map.sources['atlas-sites'], source);
});

test('playback reaches all sites in the active dataset and manual pause updates its label', async () => {
  const app = await boot();
  const get = id => app.elements.get(id);
  assert.equal(Number(get('time').min), 450);
  assert.equal(get('tickLatest').textContent, '≈ 1,500 CE');
  get('play').onclick();
  get('play').onclick();
  assert.equal(get('play').attributes['aria-label'], 'Play timeline');
  get('play').onclick();
  for (let i = 0; i < 40; i++) app.tick();
  assert.ok(get('siteRows').children.length <= 11);
  assert.equal(get('count').textContent, `${dataset.records.length} / ${dataset.records.length}`);
  assert.equal(get('timeLabel').textContent, '≈ 1,500 CE');
});

test('malformed imported records produce a visible load error', async () => {
  const app = await boot({ records: [{ id: 'Q1', coordinateCandidates: [[999, 0]], inceptionDates: [] }] });
  assert.match(app.elements.get('sites').textContent, /imported dataset could not load/);
});

test('country filtering combines with description search and supports missing countries', async () => {
  const fixture = { records: [
    { ...dataset.records[0], id: 'Q1', title: 'First', description: 'Painted cave', countries: [{ id: 'Q29', title: 'Spain' }, { id: 'Q142', title: 'France' }] },
    { ...dataset.records[0], id: 'Q2', title: 'Second', description: 'Ancient settlement', countries: [{ id: 'Q142', title: 'France' }] },
    { ...dataset.records[0], id: 'Q3', title: 'Third', description: 'Painted shelter', countries: [] }
  ] };
  const app = await boot(fixture);
  const get = id => app.elements.get(id);
  assert.equal(get('country').children.filter(c => c.value === 'Q142').length, 1);
  get('country').onchange({ target: { value: 'Q142' } });
  assert.equal(get('siteRows').children.length, 2);
  get('search').oninput({ target: { value: 'painted' } });
  assert.equal(get('siteRows').children.length, 1);
  get('siteRows').children[0].onclick();
  assert.ok(get('detail').children.some(c => c.textContent === 'Painted cave.'));
  assert.ok(get('detail').children.some(c => c.textContent?.includes('Country: Spain, France')));
  get('country').onchange({ target: { value: 'unknown' } });
  assert.equal(get('siteRows').children.length, 1);
  assert.equal(get('siteRows').children[0].children[1].children[0].textContent, 'Third');
});

test('active dataset populates the country dropdown and displays imported descriptions', async () => {
  const app = await boot();
  const get = id => app.elements.get(id);
  const countryIds = new Set(dataset.records.flatMap(r => r.countries || []).map(c => c.id));
  assert.ok(countryIds.size > 0);
  assert.equal(get('country').children.filter(c => countryIds.has(c.value)).length, countryIds.size);
  get('country').onchange({ target: { value: 'Q79' } });
  const expected = dataset.records.filter(r => r.countries.some(c => c.id === 'Q79'));
  assert.equal(get('count').textContent, `${expected.length} / ${dataset.records.length}`);
  get('search').oninput({ target: { value: 'capital city of Egypt' } });
  assert.equal(get('siteRows').children.length, 1);
  get('siteRows').children[0].onclick();
  assert.ok(get('detail').children.some(c => c.textContent === 'Capital city of Egypt.'));
});

test('timeline updates layer filters without replacing the source or layer', async () => {
  const app = await boot();
  const source = app.map.sources['atlas-sites'];
  const layer = app.map.layers['atlas-sites'];
  app.elements.get('play').onclick();
  assert.equal(JSON.stringify(layer.filter), JSON.stringify(['all', ['>', ['get', 'ageOlder'], 10000]]));
  app.tick();
  assert.equal(JSON.stringify(layer.filter), JSON.stringify(['all', ['>=', ['get', 'ageOlder'], 9750]]));
  assert.equal(app.map.sources['atlas-sites'], source);
  assert.equal(app.map.layers['atlas-sites'], layer);
});

test('50,000 sites use bounded sidebar rows and can scroll to the last site', async () => {
  const fixture = { records: Array.from({ length: 50000 }, (_, index) => ({
    ...dataset.records[0], id: `Q${index + 1}`, title: `Site ${index}`
  })) };
  const app = await boot(fixture);
  const viewport = app.elements.get('sites');
  const container = app.elements.get('siteRows');
  assert.ok(container.children.length <= 11);
  assert.equal(app.map.sources['atlas-sites'].data.features.length, 50000);
  viewport.scrollTop = 50000 * 72;
  viewport.onscroll();
  assert.ok(container.children.length <= 11);
  const last = container.children.at(-1);
  assert.equal(last.atlasSiteId, 'Q50000');
  last.onclick();
  assert.equal(app.elements.get('detail').hidden, false);
  app.elements.get('search').oninput({ target: { value: 'Site 49999' } });
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].atlasSiteId, 'Q50000');
});
