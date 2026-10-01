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
  const markers = [];
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
    addControl() {}
    on(name, callback) { mapEvents[name] = callback; }
    flyTo(value) { this.lastFlight = value; }
  }
  class MarkerStub {
    constructor({ element }) { this.element = element; }
    setLngLat(point) { this.point = point; return this; }
    addTo() { markers.push(this); return this; }
    remove() { this.removed = true; }
  }
  const context = vm.createContext({
    document, window: { maplibregl: { Map: MapStub, Marker: MarkerStub, NavigationControl: class {} } },
    URL, localStorage: { getItem: () => null }, console,
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => input }; },
    clearInterval: () => {}, setInterval: callback => { tick = callback; return 1; }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  if (mapEvents.load) mapEvents.load();
  return { context, elements, markers, requests, tick: () => tick() };
}

test('imports unique sites, plots numeric locations, searches and displays source details', async () => {
  const app = await boot();
  const get = id => app.elements.get(id);
  assert.equal(app.requests[0].url, 'data/candidates.json');
  assert.equal(app.requests[0].options.cache, 'no-store');
  assert.equal(get('sites').children.length, dataset.records.length);
  assert.equal(app.markers.filter(m => !m.removed).length, dataset.records.length);
  assert.ok(app.markers.every(m => m.point.every(Number.isFinite)));
  get('search').oninput({ target: { value: 'Altamira' } });
  assert.equal(get('sites').children.length, 1);
  get('sites').children[0].onclick();
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
  assert.equal(get('sites').children.length, 1);
  assert.equal(get('timeLabel').textContent, 'Older than 10k years');
  get('time').oninput({ target: { value: '1950' } });
  assert.equal(get('sites').children.length, 3);
  assert.equal(get('timeLabel').textContent, 'Year 0');
  get('alltime').onclick();
  assert.equal(get('sites').children.length, 4);
  get('play').onclick();
  assert.equal(get('play').attributes['aria-label'], 'Pause timeline');
  for (let i = 0; i < 60; i++) app.tick();
  assert.equal(get('sites').children.length, 4);
  assert.equal(get('timeLabel').textContent, '≈ 100 CE');
  assert.equal(get('play').textContent, '▶ Play');
  assert.equal(get('play').attributes['aria-label'], 'Play timeline');
  assert.equal(Number(get('time').value), Number(get('time').min));
});

test('selection preserves list buttons and map markers used by keyboard navigation', async () => {
  const app = await boot();
  const buttons = [...app.elements.get('sites').children];
  const markers = app.markers.filter(m => !m.removed);
  buttons[0].onclick();
  assert.deepEqual(app.elements.get('sites').children, buttons);
  assert.equal(buttons[0].className, 'site active');
  markers[1].element.onclick();
  assert.equal(buttons[0].className, 'site');
  assert.equal(buttons[1].className, 'site active');
  assert.deepEqual(app.markers.filter(m => !m.removed), markers);
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
  assert.equal(get('sites').children.length, dataset.records.length);
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
  assert.equal(get('sites').children.length, 2);
  get('search').oninput({ target: { value: 'painted' } });
  assert.equal(get('sites').children.length, 1);
  get('sites').children[0].onclick();
  assert.ok(get('detail').children.some(c => c.textContent === 'Painted cave'));
  assert.ok(get('detail').children.some(c => c.textContent?.includes('Country: Spain, France')));
  get('country').onchange({ target: { value: 'unknown' } });
  assert.equal(get('sites').children.length, 1);
  assert.equal(get('sites').children[0].children[1].children[0].textContent, 'Third');
});
