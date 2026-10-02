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
  contains(node) { return this.children.includes(node); }
  style = {};
}

async function boot(input = dataset, wikiResponse, battleInput = { records: [] }, geologyInput = { records: [] }) {
  const elements = new Map();
  let map;
  const requests = [];
  const mapEvents = {};
  const themes = ['Archaeology', 'Battles', 'Geology'].map(theme => Object.assign(new Element(), { dataset: { theme } }));
  let tick;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
    querySelectorAll: () => themes
  };
  class MapStub {
    constructor() { map = this; this.sources = {}; this.layers = {}; this.filters = []; }
    addControl() {}
    on(name, layer, callback) { mapEvents[callback ? `${name}:${layer}` : name] = callback || layer; }
    addSource(id, source) {
      source.updates = 0;
      source.setData = data => { source.data = data; source.updates++; };
      source.getClusterExpansionZoom = async () => 5;
      this.sources[id] = source;
    }
    getSource(id) { return this.sources[id]; }
    easeTo(value) { this.lastEase = value; }
    addLayer(layer) { this.layers[layer.id] = layer; }
    getLayer(id) { return this.layers[id]; }
    setPaintProperty(id, name, value) { this.layers[id].paint[name] = value; }
    setFilter(id, filter) { this.layers[id].filter = filter; this.filters.push(filter); }
    getCanvas() { return { style: {} }; }
    flyTo(value) { this.lastFlight = value; }
    fitBounds(bounds, options) { this.lastBounds = { bounds, options }; }
  }
  const context = vm.createContext({
    document, window: { maplibregl: { Map: MapStub, NavigationControl: class {} } },
    URL, AbortSignal, DOMParser: class {
      parseFromString(value) { return { body: { textContent: value.replace(/<[^>]*>/g, '') } }; }
    }, localStorage: { getItem: () => null }, console,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.startsWith('https://en.wikipedia.org/')) return wikiResponse ? wikiResponse(new URL(url)) : { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => url === 'data/battles.json' ? battleInput : url === 'data/geology.json' ? geologyInput : input };
    },
    clearInterval: () => {}, setInterval: callback => { tick = callback; return 1; }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  if (mapEvents.load) mapEvents.load();
  return { context, elements, map, mapEvents, themes, requests, tick: () => tick() };
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
  assert.match(detail.children.find(e => e.className === 'age').textContent, /BCE$/);
  const links = detail.children.find(e => e.className === 'source-links');
  assert.equal(links.children.length, 2);
  assert.ok(links.children[0].href.startsWith('https://en.wikipedia.org/'));
  assert.ok(!detail.children.some(e => e.className === 'meta' || e.className === 'fine'));
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
  assert.equal(get('timeLabel').textContent, 'Before 8050 BCE');
  get('time').oninput({ target: { value: '1950' } });
  assert.equal(get('siteRows').children.length, 3);
  assert.equal(get('timeLabel').textContent, '≈ 1 BCE');
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
  assert.equal(get('tickLatest').textContent, '≈ 1500 CE');
  get('play').onclick();
  get('play').onclick();
  assert.equal(get('play').attributes['aria-label'], 'Play timeline');
  get('play').onclick();
  for (let i = 0; i < 40; i++) app.tick();
  assert.ok(get('siteRows').children.length <= 11);
  assert.equal(get('count').textContent, `${dataset.records.length} / ${dataset.records.length}`);
  assert.equal(get('timeLabel').textContent, '≈ 1500 CE');
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
  assert.ok(get('detail').children.some(c => c.textContent === 'Country: Spain, France'));
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

test('clusters contain only visible sites and expand on click', async () => {
  const app = await boot();
  const source = app.map.sources['atlas-sites'];
  const layer = app.map.layers['atlas-sites'];
  assert.equal(source.cluster, true);
  assert.equal(source.clusterRadius, 25);
  assert.equal(source.clusterMaxZoom, 4);
  assert.ok(app.map.layers['atlas-cluster-count']);
  app.elements.get('play').onclick();
  assert.ok(source.data.features.every(f => {
    const record = dataset.records.find(r => r.id === f.id);
    return record.inceptionDates.some(d => 1950 - Number(/^([+-]?\d+)-/.exec(d.value)[1]) > 10000);
  }));
  app.tick();
  assert.equal(app.map.sources['atlas-sites'], source);
  assert.equal(app.map.layers['atlas-sites'], layer);
  app.elements.get('country').onchange({ target: { value: 'Q79' } });
  assert.ok(source.data.features.every(f => dataset.records.find(r => r.id === f.id).countries.some(c => c.id === 'Q79')));
  await app.mapEvents['click:atlas-clusters']({ features: [{ properties: { cluster_id: 1 }, geometry: { coordinates: [31, 30] } }] });
  assert.equal(app.map.lastEase.zoom, 5);
  assert.ok(app.map.lastEase.zoom > source.clusterMaxZoom);
  const updates = source.updates;
  app.elements.get('reset').onclick();
  assert.equal(source.updates, updates);
  app.elements.get('search').oninput({ target: { value: 'no-such-site-xyz' } });
  assert.equal(source.data.features.length, 0);
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

test('country selection fits matching sites, handles the dateline and resets All countries', async () => {
  const fixture = { records: [[179, -15], [-179, -20]].map((coordinates, i) => ({
    ...dataset.records[0], id: `Q${i + 1}`, coordinateCandidates: [coordinates],
    countries: [{ id: 'Q712', title: 'Fiji' }]
  })) };
  const app = await boot(fixture);
  const country = app.elements.get('country');
  country.onchange({ target: { value: 'Q712' } });
  assert.equal(JSON.stringify(app.map.lastBounds.bounds), JSON.stringify([[179, -20], [181, -15]]));
  assert.equal(app.map.lastBounds.options.maxZoom, 6);
  const previous = app.map.lastBounds;
  country.onchange({ target: { value: 'Q999' } });
  assert.equal(app.map.lastBounds, previous);
  country.onchange({ target: { value: 'all' } });
  assert.equal(app.map.lastFlight.zoom, 1.8);
});

test('country search narrows choices and clear filters restores all sites and stops playback', async () => {
  const app = await boot();
  const get = id => app.elements.get(id);
  get('countrySearch').oninput({ target: { value: 'egy' } });
  const egypt = get('country').children.find(c => c.value === 'Q79');
  assert.equal(egypt.hidden, false);
  assert.ok(get('country').children.some(c => c.hidden));
  get('country').onchange({ target: { value: 'Q79' } });
  get('search').oninput({ target: { value: 'Cairo' } });
  get('play').onclick();
  get('clearFilters').onclick();
  assert.equal(get('count').textContent, `${dataset.records.length} / ${dataset.records.length}`);
  assert.equal(get('timeLabel').textContent, 'All imported dates');
  assert.equal(get('play').attributes['aria-label'], 'Play timeline');
  assert.equal(get('country').value, 'all');
  assert.equal(get('countrySearch').value, '');
  assert.equal(get('search').value, '');
  assert.ok(get('country').children.every(c => !c.hidden));
  assert.equal(app.map.lastFlight.zoom, 1.8);
});

test('cards load a credited thumbnail on demand and cache repeat selections', async () => {
  const app = await boot(dataset, url => ({ ok: true, json: async () => url.searchParams.get('prop') === 'pageimages'
    ? { query: { pages: [{ thumbnail: { source: 'https://thumb.wikimedia.org/example.jpg' }, pageimage: 'Example.jpg' }] } }
    : { query: { pages: [{ imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Example.jpg',
      extmetadata: { Artist: { value: '<b>Example author</b>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }] } }
  }));
  assert.equal(app.requests.length, 3);
  const button = app.elements.get('siteRows').children[0];
  button.onclick();
  await new Promise(resolve => setImmediate(resolve));
  const figure = app.elements.get('detail').children.find(e => e.className === 'site-image');
  assert.equal(figure.hidden, false);
  assert.equal(figure.children[0].src, 'https://thumb.wikimedia.org/example.jpg');
  assert.equal(figure.children[1].children[0].textContent, 'Example author · CC BY-SA 4.0');
  assert.equal(app.requests.length, 5);
  button.onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.requests.length, 5);
});


test('battle event dates load alongside archaeology and category filtering updates clusters', async () => {
  const record = { ...dataset.records[0], id: 'QBattle', title: 'Example battle', category: 'Battles',
    eventDates: [{ ...dataset.records[0].inceptionDates[0], value: '1815-06-18T00:00:00Z', property: 'P585' }] };
  delete record.inceptionDates;
  const app = await boot(dataset, undefined, { records: [record] });
  app.themes.find(b => b.dataset.theme === 'Battles').onclick();
  assert.equal(app.map.layers['atlas-clusters'].paint['circle-color'], '#e68c82');
  assert.equal(app.elements.get('count').textContent, '1 / 1');
  const feature = app.map.sources['atlas-sites'].data.features[0];
  assert.equal(feature.properties.category, 'Battles');
  app.elements.get('siteRows').children[0].onclick();
  assert.equal(app.elements.get('detail').children.find(e => e.className === 'age').textContent, '≈ 1815 CE');
  app.themes.find(b => b.dataset.theme === 'Archaeology').onclick();
  assert.equal(app.map.layers['atlas-clusters'].paint['circle-color'], '#e7bc7a');
  assert.equal(app.map.sources['atlas-sites'].data.features.length, dataset.records.length);
});

test('saved battle dataset loads with archaeology and exposes all battle records', async () => {
  const battles = JSON.parse(fs.readFileSync(path.join(root, 'data/battles.json'), 'utf8'));
  const app = await boot(dataset, undefined, battles);
  assert.ok(battles.records.length > 0);
  app.themes.find(b => b.dataset.theme === 'Battles').onclick();
  assert.equal(app.map.sources['atlas-sites'].data.features.length, battles.records.length);
  assert.ok(app.map.sources['atlas-sites'].data.features.every(f => f.properties.category === 'Battles'));
});

test('views isolate countries, dates and clear-filter behavior', async () => {
  const archaeology = { records: [{ ...dataset.records[0], countries: [{ id: 'Q79', title: 'Egypt' }] }] };
  const battle = { ...dataset.records[0], id: 'QBattleView', category: 'Battles',
    countries: [{ id: 'Q31', title: 'Belgium' }],
    eventDates: [{ ...dataset.records[0].inceptionDates[0], value: '1815-06-18T00:00:00Z', property: 'P585' }] };
  const app = await boot(archaeology, undefined, { records: [battle] });
  const get = id => app.elements.get(id);
  assert.equal(get('viewTitle').textContent, 'Explore archaeology.');
  assert.ok(!get('country').children.some(c => c.value === 'Q31'));
  get('search').oninput({ target: { value: 'nothing' } });
  app.themes.find(b => b.dataset.theme === 'Battles').onclick();
  assert.equal(get('viewTitle').textContent, 'Explore battles.');
  assert.equal(get('atlasApp').attributes['data-view'], 'Battles');
  assert.equal(get('search').value, '');
  assert.equal(get('count').textContent, '1 / 1');
  assert.ok(get('country').children.some(c => c.value === 'Q31'));
  assert.ok(!get('country').children.some(c => c.value === 'Q79'));
  assert.equal(Number(get('time').max), 150);
  get('play').onclick();
  get('clearFilters').onclick();
  assert.equal(app.map.sources['atlas-sites'].data.features[0].properties.category, 'Battles');
  assert.equal(get('legendLabel').textContent, 'Battle');
  app.themes.find(b => b.dataset.theme === 'Archaeology').onclick();
  assert.equal(Number(get('time').max), 10000);
  assert.equal(get('atlasApp').attributes['data-view'], 'Archaeology');
  assert.equal(get('detail').hidden, true);
});


test('Geology view shows five green samples without historical dates and supports country filtering', async () => {
  const geology = JSON.parse(fs.readFileSync(path.join(root, 'data/geology.json'), 'utf8'));
  const app = await boot(dataset, undefined, { records: [] }, geology);
  const get = id => app.elements.get(id);
  app.themes.find(b => b.dataset.theme === 'Geology').onclick();
  assert.equal(get('count').textContent, '5 / 5');
  assert.equal(get('atlasApp').attributes['data-view'], 'Geology');
  assert.equal(get('timeline').hidden, true);
  assert.equal(app.map.layers['atlas-clusters'].paint['circle-color'], '#80c995');
  get('siteRows').children[0].onclick();
  assert.equal(get('detail').children.find(c => c.className === 'age').textContent, 'Canyon');
  get('country').onchange({ target: { value: 'Q30' } });
  assert.equal(get('count').textContent, '2 / 5');
  get('clearFilters').onclick();
  assert.equal(get('count').textContent, '5 / 5');
  app.themes.find(b => b.dataset.theme === 'Archaeology').onclick();
  assert.equal(get('timeline').hidden, false);
});
