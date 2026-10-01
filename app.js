'use strict';

const $ = id => document.getElementById(id);
let data = [],
  map,
  markers = [],
  theme = 'all',
  query = '',
  threshold = 1950,
  country = 'all',
  allTime = true,
  selected = null,
  timer = null,
  journeyIndex = -1;
const colors = {
  Origins: '#e7bc7a',
  Migration: '#76bfcc',
  Culture: '#c49bc9',
  Archaeology: '#e7bc7a'
};
const fmt = n => n.toLocaleString('en-US');
function formatDescription(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) return 'Explore this archaeological site through its Wikipedia article and Wikidata record.';
  const sentence = text.replace(/\p{L}/u, letter => letter.toLocaleUpperCase('en-US'));
  return /[.!?…]["'”’\)\]]*$/.test(sentence) ? sentence : `${sentence}.`;
}
const age = s => `≈ ${fmt(s.ageOlder)} years BP`;
let timelineMin = 1950; // Updated from the latest imported timeline point.
const timelineMax = 10000; // Oldest position groups all dates older than 10k BP.
const calendarLabel = bp => bp === 1950 ? 'Year 0'
  : bp > 1950 ? `≈ ${fmt(Math.round(bp - 1950))} BCE` : `≈ ${fmt(Math.round(1950 - bp))} CE`;
const timelineLabel = () => threshold === timelineMax ? 'Older than 10k years'
  : calendarLabel(threshold);

function importedSites(dataset) {
  if (!Array.isArray(dataset.records) || !dataset.records.length) throw new Error('No imported sites');
  return dataset.records.map(record => {
    const coordinates = record.coordinateCandidates?.[0];
    const dates = record.inceptionDates;
    if (!coordinates || coordinates.length !== 2 || !coordinates.every(Number.isFinite) ||
        Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90 || !dates?.length) throw new Error('Invalid imported site');
    // Use the oldest recorded inception as a single timeline point, not an occupation range.
    const years = dates.map(d => Number(/^([+-]?\d+)-/.exec(d.value)?.[1]));
    if (!years.every(Number.isFinite)) throw new Error('Invalid imported date');
    const oldestYear = Math.min(...years);
    const ageOlder = 1950 - oldestYear;
    const timelineDate = dates[years.indexOf(oldestYear)];
    const countries = record.countries || [];
    return { ...record, coordinates, ageOlder, timelineDate, theme: 'Archaeology',
      countries, region: countries.map(c => c.title).join(', ') || 'Country not recorded',
      description: formatDescription(record.description),
      isTestData: false };
  });
}

function visible() {
  return data.filter(s => (theme === 'all' || s.theme === theme) &&
    (country === 'all' || (country === 'unknown' ? !s.countries.length : s.countries.some(c => c.id === country))) &&
    (!query || `${s.id} ${s.title} ${s.region} ${s.description}`.toLowerCase().includes(query)) &&
    (allTime || (threshold === timelineMax ? s.ageOlder > timelineMax : s.ageOlder >= threshold)));
}

function stop() {
  clearInterval(timer);
  timer = null;
  $('play').textContent = '▶ Play';
  $('play').setAttribute('aria-label', 'Play timeline');
}

function refresh() {
  const list = visible();
  $('count').textContent = `${list.length} / ${data.length}`;
  $('sites').replaceChildren();
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'site' + (selected === s.id ? ' active' : '');
    b.atlasSiteId = s.id;
    const dot = document.createElement('i');
    dot.className = s.theme;
    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = s.title;
    const sub = document.createElement('small');
    sub.textContent = `${age(s)} · ${s.timelineDate.precisionLabel} precision`;
    text.append(name, sub);
    b.append(dot, text);
    b.onclick = () => selectSite(s.id);
    $('sites').append(b);
  }
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No sites match. Try another search or time.';
    $('sites').append(p);
  }
  const visibleIds = new Set(list.map(s => s.id));
  markers = markers.filter(marker => {
    if (visibleIds.has(marker.atlasSiteId)) return true;
    marker.remove();
    return false;
  });
  if (map) {
    const lib = map._atlasLib;
    const existingIds = new Set(markers.map(marker => marker.atlasSiteId));
    for (const s of list) {
      if (existingIds.has(s.id)) continue;
      const el = document.createElement('button');
      el.className = 'marker';
      el.style.background = colors[s.theme];
      el.setAttribute('aria-label', `${s.title}, ${s.theme}, ${age(s)}`);
      el.onclick = () => selectSite(s.id);
      const marker = new lib.Marker({
        element: el
      }).setLngLat(s.coordinates).addTo(map);
      marker.atlasSiteId = s.id;
      markers.push(marker);
    }
  }
  $('timeLabel').textContent = allTime ? 'All imported dates' : timelineLabel();
  $('time').setAttribute('aria-valuetext', timelineLabel());
  if (selected && !list.some(s => s.id === selected)) {
    selected = null;
    $('detail').hidden = true;
  }
}

function selectSite(id, fly = true) {
  const s = data.find(x => x.id === id);
  if (!s) throw new Error('Unknown site');
  selected = id;
  // Selection does not change the filters. Keep the existing controls and focus.
  for (const button of $('sites').children) {
    if (button.atlasSiteId) button.className = 'site' + (button.atlasSiteId === selected ? ' active' : '');
  }
  const a = $('detail');
  a.replaceChildren();
  a.hidden = false;
  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Close site details');
  close.onclick = () => {
    selected = null;
    a.hidden = true;
    refresh();
  };
  const tag = document.createElement('span');
  tag.className = 'eyebrow';
  tag.textContent = `${s.theme.toUpperCase()} · ${s.id}`;
  const h = document.createElement('h2');
  h.textContent = s.title;
  const date = document.createElement('div');
  date.className = 'age';
  date.textContent = age(s);
  const p = document.createElement('p');
  p.textContent = s.description;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `Country: ${s.region}\n` + s.inceptionDates.map(d =>
    `Recorded inception: ${d.value.split('T')[0]} · ${d.precisionLabel} precision · ${d.calendarModel.endsWith('/Q1985727') ? 'Gregorian' : d.calendarModel.endsWith('/Q1985786') ? 'Julian' : d.calendarModel}`
  ).join('\n');
  const disclaimer = document.createElement('p');
  disclaimer.className = 'fine';
  disclaimer.textContent = 'Timeline uses the recorded inception year as an approximate point, in years before 1950 (BP).'
    + (s.inceptionDates.length > 1 ? ' The oldest recorded inception is used; all values are listed above.' : '')
    + (s.coordinateCandidates.length > 1 ? ` Showing the first of ${s.coordinateCandidates.length} recorded locations.` : '');
  a.append(close, tag, h, date, p, meta, disclaimer);
  const links = document.createElement('div');
  links.className = 'source-links';
  for (const [label, url] of [['Wikipedia', s.wikipediaUrls[0]], ['Wikidata', s.wikidataUrl]]) {
    const parsed = new URL(url);
    if (!['en.wikipedia.org', 'www.wikidata.org'].includes(parsed.hostname) || !['https:', 'http:'].includes(parsed.protocol)) continue;
    const link = document.createElement('a');
    link.href = parsed.href;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    links.append(link);
  }
  a.append(links);
  if (journeyIndex >= 0) {
    const foot = document.createElement('footer');
    const prev = document.createElement('button');
    prev.textContent = 'Previous';
    prev.disabled = journeyIndex === 0;
    prev.onclick = () => journeyStep(-1);
    const next = document.createElement('button');
    next.textContent = journeyIndex === 5 ? 'Finish journey' : `Next · ${journeyIndex + 1}/6`;
    next.onclick = () => {
      if (journeyIndex === 5) {
        journeyIndex = -1;
        selectSite(id, false);
      } else journeyStep(1);
    };
    foot.append(prev, next);
    a.append(foot);
  }
  if (map && fly) map.flyTo({
    center: s.coordinates,
    zoom: 4,
    speed: .8
  });
}

function journeyStep(delta) {
  journeyIndex += delta;
  const s = data.filter(x => x.journeyOrder).sort((a, b) => a.journeyOrder - b.journeyOrder)[journeyIndex];
  selectSite(s.id);
}

function mapFailure(message) {
  $('maperror').hidden = false;
  $('maperror').textContent = message;
}

function createMap(token) {
  if (map) {
    markers.forEach(m => m.remove());
    markers = [];
    map.remove();
    map = null;
  }
  $('maperror').hidden = true;
  const lib = token ? window.mapboxgl : window.maplibregl;
  if (!lib) {
    mapFailure('The map library could not load. Check your connection and reload. You can still browse the sites.');
    return;
  }
  try {
    if (token) lib.accessToken = token;
    map = new lib.Map({
      container: 'map',
      style: token ? 'mapbox://styles/mapbox/light-v11' : {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors © CARTO'
          }
        },
        layers: [{
          id: 'base',
          type: 'raster',
          source: 'base'
        }]
      },
      center: [28, 16],
      zoom: 1.8,
      minZoom: 1,
      maxZoom: 15,
      ...(token ? {
        projection: 'globe'
      } : {})
    });
    map._atlasLib = lib;
    map.addControl(new lib.NavigationControl({
      showCompass: false
    }), 'top-right');
    map.on('load', () => {
      refresh();
      $('mapmode').textContent = token ? 'Mapbox · modern geography' : 'Demo basemap · Mapbox ready';
      if (token) map.setFog({
        color: '#182633',
        'high-color': '#0d1721',
        'space-color': '#0d1721',
        'horizon-blend': .1
      });
    });
    map.on('error', e => {
      if (token) mapFailure('Mapbox could not load. Check the public token and allowed website URLs in Map settings, or switch to the demo map.');else mapFailure('The demo basemap could not load. Check your connection; site details remain available.');
    });
  } catch (e) {
    mapFailure('The map could not start. Your browser may not support WebGL. Site details are still available.');
  }
}
$('search').oninput = e => {
  query = e.target.value.toLowerCase().trim();
  journeyIndex = -1;
  refresh();
};
$('country').onchange = e => {
  country = e.target.value;
  journeyIndex = -1;
  refresh();
};
document.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => {
  theme = b.dataset.theme;
  journeyIndex = -1;
  document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  refresh();
});
$('time').oninput = e => {
  stop();
  threshold = Number(e.target.value);
  allTime = false;
  journeyIndex = -1;
  refresh();
};
$('alltime').onclick = () => {
  stop();
  allTime = true;
  threshold = timelineMin;
  $('time').value = timelineMin;
  refresh();
};
$('play').onclick = () => {
  if (timer) {
    stop();
    return;
  }
  allTime = false;
  threshold = timelineMax;
  $('time').value = threshold;
  refresh();
  $('play').textContent = 'Ⅱ Pause';
  $('play').setAttribute('aria-label', 'Pause timeline');
  timer = setInterval(() => {
    threshold = Math.max(timelineMin, threshold - 250);
    $('time').value = threshold;
    refresh();
    if (threshold === timelineMin) stop();
  }, 350);
};
$('reset').onclick = () => {
  if (map) map.flyTo({
    center: [28, 16],
    zoom: 1.8
  });
  selected = null;
  $('detail').hidden = true;
  refresh();
};
$('journey').onclick = () => {
  stop();
  allTime = true;
  theme = 'all';
  query = '';
  country = 'all';
  $('country').value = 'all';
  $('search').value = '';
  document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === 'all')));
  journeyIndex = -1;
  refresh();
  journeyStep(1);
};
$('settings').onclick = () => $('config').showModal();
$('closeconfig').onclick = () => $('config').close();
$('tokenform').onsubmit = e => {
  e.preventDefault();
  const t = $('token').value.trim();
  if (!/^pk\.[A-Za-z0-9._-]+$/.test(t)) {
    $('tokenerror').textContent = 'Enter a valid public Mapbox token beginning with pk.';
    return;
  }
  $('tokenerror').textContent = '';
  try {
    localStorage.setItem('origins.mapbox.publicToken', t);
  } catch {}
  createMap(t);
  $('config').close();
};
$('demo').onclick = () => {
  try {
    localStorage.removeItem('origins.mapbox.publicToken');
  } catch {}
  $('token').value = '';
  createMap('');
  $('config').close();
};

async function init() {
  try {
    const r = await fetch('data/candidates.json', { cache: 'no-store' });
    if (!r.ok) throw Error();
    data = importedSites(await r.json());
    const countries = [...new Map(data.flatMap(s => s.countries).map(c => [c.id, c])).values()]
      .sort((a, b) => a.title.localeCompare(b.title));
    for (const c of countries) {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.title;
      $('country').append(option);
    }
    if (data.some(s => !s.countries.length)) {
      const option = document.createElement('option');
      option.value = 'unknown';
      option.textContent = 'Country not recorded';
      $('country').append(option);
    }
    // Round down to a slider step so every site's timeline point is reachable.
    timelineMin = Math.min(1950, Math.floor(Math.min(...data.map(s => s.ageOlder)) / 50) * 50);
    $('timedesc').textContent = `Show sites cumulatively through ${calendarLabel(timelineMin)}. The oldest position groups dates older than 10k years (before 1950).`;
    $('tickMiddleOlder').textContent = calendarLabel(timelineMax - (timelineMax - timelineMin) / 3);
    $('tickMiddleYounger').textContent = calendarLabel(timelineMax - 2 * (timelineMax - timelineMin) / 3);
    $('tickLatest').textContent = calendarLabel(timelineMin);
    threshold = timelineMin;
    $('time').min = timelineMin;
    $('time').max = timelineMax;
    $('time').value = timelineMin;
    refresh();
    let token = '';
    try {
      token = localStorage.getItem('origins.mapbox.publicToken') || '';
    } catch {}
    $('token').value = token;
    createMap(token);
    const c = document.modelContext;
    if (c?.registerTool) {
      const controller = new AbortController();
      const tool = {
        name: 'explore_atlas_site',
        description: 'Select an imported archaeological site and navigate the visible atlas to it.',
        inputSchema: {
          type: 'object',
          properties: {
            siteId: {
              type: 'string'
            }
          },
          required: ['siteId'],
          additionalProperties: false
        },
        annotations: {
          readOnlyHint: false,
          untrustedContentHint: false
        },
        execute: input => {
          if (!input || typeof input.siteId !== 'string' || !data.some(s => s.id === input.siteId)) throw new Error('A known siteId is required');
          allTime = true;
          theme = 'all';
          query = '';
          country = 'all';
          $('country').value = 'all';
          $('search').value = '';
          document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === 'all')));
          refresh();
          selectSite(input.siteId);
          return {
            selectedSiteId: selected,
            testData: false
          };
        }
      };
      Promise.resolve(c.registerTool(tool, {
        signal: controller.signal
      })).catch(() => {});
      window.addEventListener('pagehide', () => controller.abort(), {
        once: true
      });
    }
  } catch (e) {
    $('sites').textContent = 'The imported dataset could not load. Run the Wikidata importer, then reload to try again.';
  }
}
init();
