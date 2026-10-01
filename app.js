'use strict';

const $ = id => document.getElementById(id);
let data = [],
  map,
  markers = [],
  theme = 'all',
  query = '',
  threshold = 10000,
  allTime = true,
  selected = null,
  timer = null,
  journeyIndex = -1;
const colors = {
  Origins: '#e7bc7a',
  Migration: '#76bfcc',
  Culture: '#c49bc9'
};
const fmt = n => n.toLocaleString('en-US');
const age = s => `${fmt(s.ageOlder)}–${fmt(s.ageYounger)} years ago`;

function visible() {
  return data.filter(s => (theme === 'all' || s.theme === theme) && (!query || `${s.title} ${s.region} ${s.description}`.toLowerCase().includes(query)) && (allTime || s.ageOlder >= threshold));
}

function stop() {
  clearInterval(timer);
  timer = null;
  $('play').textContent = '▶ Play';
}

function refresh() {
  const list = visible();
  $('count').textContent = `${list.length} / ${data.length}`;
  $('sites').replaceChildren();
  for (const s of list) {
    const b = document.createElement('button');
    b.className = 'site' + (selected === s.id ? ' active' : '');
    const dot = document.createElement('i');
    dot.className = s.theme;
    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = s.title;
    const sub = document.createElement('small');
    sub.textContent = `${s.region} · ${fmt(s.ageOlder / 1000)}–${fmt(s.ageYounger / 1000)}k years ago`;
    text.append(name, sub);
    b.append(dot, text);
    b.onclick = () => selectSite(s.id);
    $('sites').append(b);
  }
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No sample sites match. Try another theme, search, or time.';
    $('sites').append(p);
  }
  for (const m of markers) m.remove();
  markers = [];
  if (map) {
    const lib = map._atlasLib;
    for (const s of list) {
      const el = document.createElement('button');
      el.className = 'marker';
      el.style.background = colors[s.theme];
      el.setAttribute('aria-label', `${s.title}, ${s.theme}, ${age(s)}`);
      el.onclick = () => selectSite(s.id);
      markers.push(new lib.Marker({
        element: el
      }).setLngLat(s.coordinates).addTo(map));
    }
  }
  $('timeLabel').textContent = allTime ? '300,000–10,000 years ago' : `${fmt(threshold)} years ago`;
  if (selected && !list.some(s => s.id === selected)) {
    selected = null;
    $('detail').hidden = true;
  }
}

function selectSite(id, fly = true) {
  const s = data.find(x => x.id === id);
  if (!s) throw new Error('Unknown site');
  selected = id;
  refresh();
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
  tag.textContent = `${s.theme.toUpperCase()} · TEST SITE`;
  const h = document.createElement('h2');
  h.textContent = s.title;
  const date = document.createElement('div');
  date.className = 'age';
  date.textContent = age(s);
  const p = document.createElement('p');
  p.textContent = s.description;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${s.region} · Approximate location\nIllustrative age range. No verified sources attached.`;
  const disclaimer = document.createElement('p');
  disclaimer.className = 'fine';
  disclaimer.textContent = 'This record is synthetic. Replace it with sourced archaeological evidence before treating the atlas as a historical reference.';
  a.append(close, tag, h, date, p, meta, disclaimer);
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
    mapFailure('The map library could not load. Check your connection and reload. You can still browse the sample sites.');
    return;
  }
  try {
    if (token) lib.accessToken = token;
    map = new lib.Map({
      container: 'map',
      style: token ? 'mapbox://styles/mapbox/dark-v11' : {
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
  threshold = 10000;
  $('time').value = 10000;
  refresh();
};
$('play').onclick = () => {
  if (timer) {
    stop();
    return;
  }
  allTime = false;
  threshold = 300000;
  $('time').value = threshold;
  refresh();
  $('play').textContent = 'Ⅱ Pause';
  timer = setInterval(() => {
    threshold = Math.max(10000, threshold - 5000);
    $('time').value = threshold;
    refresh();
    if (threshold === 10000) stop();
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
    const r = await fetch('sites.json');
    if (!r.ok) throw Error();
    data = await r.json();
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
        description: 'Select an illustrative history site and navigate the visible atlas to it.',
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
          $('search').value = '';
          document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === 'all')));
          selectSite(input.siteId);
          return {
            selectedSiteId: selected,
            testData: true
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
    $('sites').textContent = 'The sample dataset could not load. Reload to try again.';
  }
}
init();
