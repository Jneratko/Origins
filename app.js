'use strict';

const $ = id => document.getElementById(id);
let data = [],
  map,
  filteredSites = [],
  sitesById = new Map(),
  theme = 'Archaeology',
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
  Archaeology: '#e7bc7a',
  Battles: '#e68c82',
  Geology: '#80c995'
};
const fmt = n => n.toLocaleString('en-US');
function formatDescription(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text) return 'Explore this archaeological site through its Wikipedia article and Wikidata record.';
  const sentence = text.replace(/\p{L}/u, letter => letter.toLocaleUpperCase('en-US'));
  return /[.!?…]["'”’\)\]]*$/.test(sentence) ? sentence : `${sentence}.`;
}
const age = s => s.theme === 'Geology' ? s.featureType || 'Geological site' : calendarLabel(s.ageOlder);
let timelineMin = 1950; // Updated from the latest imported timeline point.
let timelineMax = 10000; // Oldest position groups all dates older than 10k BP.
const calendarLabel = bp => bp === 1950 ? '≈ 1 BCE'
  : bp > 1950 ? `≈ ${Math.round(bp - 1950)} BCE` : `≈ ${Math.round(1950 - bp)} CE`;
const timelineLabel = () => theme === 'Archaeology' && threshold === timelineMax ? 'Before 8050 BCE'
  : calendarLabel(threshold);

function importedSites(dataset) {
  if (!Array.isArray(dataset.records) || !dataset.records.length) throw new Error('No imported sites');
  return dataset.records.map(record => {
    const coordinates = record.coordinateCandidates?.[0];
    const dates = record.eventDates || record.inceptionDates || [];
    if (!coordinates || coordinates.length !== 2 || !coordinates.every(Number.isFinite) ||
        Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90 || (!dates.length && record.category !== 'Geology')) throw new Error('Invalid imported site');
    // Use the oldest recorded inception as a single timeline point, not an occupation range.
    const years = dates.map(d => Number(/^([+-]?\d+)-/.exec(d.value)?.[1]));
    if (!years.every(Number.isFinite)) throw new Error('Invalid imported date');
    const oldestYear = years.length ? Math.min(...years) : null;
    const ageOlder = oldestYear === null ? null : 1950 - oldestYear;
    const timelineDate = dates[years.indexOf(oldestYear)];
    const countries = record.countries || [];
    return { ...record, coordinates, ageOlder, timelineDate, theme: record.category || 'Archaeology',
      countries, region: countries.map(c => c.title).join(', ') || 'Country not recorded',
      description: formatDescription(record.description),
      isTestData: false };
  });
}

function visible() {
  return data.filter(s => (theme === 'all' || s.theme === theme) &&
    (country === 'all' || (country === 'unknown' ? !s.countries.length : s.countries.some(c => c.id === country))) &&
    (!query || s.searchText.includes(query)) &&
    (allTime || (theme === 'Archaeology' && threshold === timelineMax ? s.ageOlder > timelineMax : s.ageOlder >= threshold)));
}

function stop() {
  clearInterval(timer);
  timer = null;
  $('play').textContent = '▶ Play';
  $('play').setAttribute('aria-label', 'Play timeline');
}

const rowHeight = 72;
function renderSiteRows() {
  const container = $('sites');
  const rowContainer = $('siteRows');
  const viewport = container.clientHeight || 350;
  const maxScroll = Math.max(0, filteredSites.length * rowHeight - viewport);
  container.scrollTop = Math.min(container.scrollTop || 0, maxScroll);
  const start = Math.max(0, Math.floor(container.scrollTop / rowHeight) - 3);
  const end = Math.min(filteredSites.length, start + Math.ceil(viewport / rowHeight) + 6);
  const rows = filteredSites.slice(start, end);
  rowContainer.style.paddingTop = `${start * rowHeight}px`;
  rowContainer.style.paddingBottom = `${(filteredSites.length - end) * rowHeight}px`;
  if (rows.length && rowContainer.children.length === rows.length &&
      rows.every((s, i) => rowContainer.children[i].atlasSiteId === s.id)) return;
  rowContainer.replaceChildren();
  for (const s of rows) {
    const b = document.createElement('button');
    b.className = 'site' + (selected === s.id ? ' active' : '');
    b.atlasSiteId = s.id;
    const dot = document.createElement('i');
    dot.className = s.theme;
    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = s.title;
    const sub = document.createElement('small');
    sub.textContent = age(s);
    text.append(name, sub);
    b.append(dot, text);
    b.setAttribute('aria-posinset', filteredSites.indexOf(s) + 1);
    b.setAttribute('aria-setsize', filteredSites.length);
    b.onclick = () => selectSite(s.id);
    b.onkeydown = e => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const index = filteredSites.indexOf(s);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? filteredSites.length - 1
        : Math.max(0, Math.min(filteredSites.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
      container.scrollTop = next * rowHeight;
      renderSiteRows();
      [...rowContainer.children].find(b => b.atlasSiteId === filteredSites[next].id)?.focus();
    };
    rowContainer.append(b);
  }
  if (!filteredSites.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No sites match. Try another search or time.';
    rowContainer.append(p);
  }
}

function pointCollection(sites) {
  return { type: 'FeatureCollection', features: sites.map(s => ({
    type: 'Feature', id: s.id, geometry: { type: 'Point', coordinates: s.coordinates },
    properties: { siteId: s.id, category: s.theme }
  })) };
}

function syncClusterSource() {
  const source = map?.getSource('atlas-sites');
  if (!source) return;
  const ids = filteredSites.map(s => s.id);
  if (map._atlasVisibleIds?.length === ids.length && ids.every((id, i) => id === map._atlasVisibleIds[i])) return;
  source.setData(pointCollection(filteredSites));
  map._atlasVisibleIds = ids;
}

const wikiImageCache = new Map();
let wikiImageQueue = Promise.resolve(), wikiRetryAt = 0;
async function wikiRequest(parameters) {
  if (Date.now() < wikiRetryAt) throw new Error('Wikipedia requests paused');
  const url = new URL('https://en.wikipedia.org/w/api.php');
  for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: 2,
    origin: '*', ...parameters })) url.searchParams.set(key, value);
  const response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(10000),
    headers: { 'Api-User-Agent': 'OriginsAtlas/1.0 (https://github.com/Jneratko/Origins)' } });
  if (!response.ok) {
    const retry = response.headers?.get('retry-after');
    const delay = retry && Number.isFinite(Number(retry)) ? Number(retry) * 1000
      : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 60000;
    if (response.status === 429 || response.status === 503) wikiRetryAt = Date.now() + (delay || 60000);
    throw new Error('Wikipedia image unavailable');
  }
  const result = await response.json();
  if (result.error) throw new Error('Wikipedia API error');
  return result;
}
function wikiImage(article) {
  const cached = wikiImageCache.get(article);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = wikiImageQueue.then(async () => {
    const url = new URL(article);
    if (url.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return null;
    const title = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
    const result = await wikiRequest({ prop: 'pageimages', titles: title, redirects: 1,
      piprop: 'thumbnail|name', pithumbsize: 640, pilicense: 'free' });
    const page = result.query?.pages?.[0];
    if (!page?.thumbnail?.source || !page.pageimage) return null;
    const imageUrl = new URL(page.thumbnail.source);
    if (imageUrl.protocol !== 'https:' || !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(imageUrl.hostname)) return null;
    const info = await wikiRequest({ prop: 'imageinfo', titles: `File:${page.pageimage}`,
      iiprop: 'url|extmetadata' });
    const imageInfo = info.query?.pages?.[0]?.imageinfo?.[0];
    if (!imageInfo?.descriptionurl) return null;
    const creditUrl = new URL(imageInfo.descriptionurl);
    if (creditUrl.protocol !== 'https:' || !['commons.wikimedia.org', 'en.wikipedia.org'].includes(creditUrl.hostname)) return null;
    const metadata = imageInfo.extmetadata || {};
    // Metadata may contain markup; render it as plain text only.
    const plain = value => new DOMParser().parseFromString(value || '', 'text/html').body.textContent.trim();
    return { source: imageUrl.href, creditUrl: creditUrl.href,
      credit: [plain(metadata.Artist?.value), plain(metadata.LicenseShortName?.value)].filter(Boolean).join(' · ') };
  }).catch(() => {
    const entry = wikiImageCache.get(article);
    if (entry) entry.expires = Date.now() + 60000;
    return null;
  });
  wikiImageQueue = promise.then(() => {});
  wikiImageCache.set(article, { promise, expires: Date.now() + 86400000 });
  return promise;
}

const views = {
  Archaeology: { title: 'Before the world had names.', intro: 'Explore our beginnings, one place and one moment at a time.',
    notice: 'Archaeological sites', search: 'Search places or discoveries…', legend: 'Archaeological site' },
  Battles: { title: 'Where history changed course.', intro: 'Explore the clashes that shaped our world, one place and one moment at a time.',
    notice: 'Historic battles', search: 'Search battles or events…', legend: 'Battle' },
  Geology: { title: 'Before the human story.', intro: 'Explore a world written in stone, shaped by fire, water, and time.',
    notice: 'Five geological sample locations', search: 'Search geological features…', legend: 'Geological site' }
};
function switchView(name, resetMap = true) {
  if (!views[name]) return;
  stop();
  theme = name;
  $('atlasApp').setAttribute('data-view', name);
  query = '';
  country = 'all';
  allTime = true;
  selected = null;
  journeyIndex = -1;
  $('detail').hidden = true;
  $('search').value = '';
  $('countrySearch').value = '';
  $('sites').scrollTop = 0;
  const view = views[name];
  $('viewTitle').textContent = view.title;
  $('filterPanel').open = false;
  $('viewIntro').textContent = view.intro;
  $('viewNotice').textContent = view.notice;
  $('search').placeholder = view.search;
  $('listTitle').textContent = `EXPLORE ${name === 'Battles' ? 'BATTLES' : name === 'Geology' ? 'GEOLOGY' : 'SITES'}`;
  $('timeline').hidden = name === 'Geology';
  $('legendLabel').textContent = view.legend;
  $('legendDot').className = name;
  $('viewFoot').textContent = name;
  const viewData = data.filter(s => s.theme === name);
  $('categoryStatus').textContent = viewData.length ? '' : `${name} data is unavailable.`;
  $('country').replaceChildren();
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'All countries';
  $('country').append(all);
    const countries = [...new Map(viewData.flatMap(s => s.countries).map(c => [c.id, c])).values()]
      .sort((a, b) => a.title.localeCompare(b.title));
    for (const c of countries) {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.title;
      $('country').append(option);
    }
    if (viewData.some(s => !s.countries.length)) {
      const option = document.createElement('option');
      option.value = 'unknown';
      option.textContent = 'Country not recorded';
      $('country').append(option);
    }
    // Round down to a slider step so every site's timeline point is reachable.
    timelineMin = Math.min(1950, Math.floor(viewData.reduce((min, s) => Math.min(min, s.ageOlder), Infinity) / 50) * 50);
    timelineMax = theme === 'Archaeology' ? 10000 : Math.max(timelineMin + 50,
      Math.ceil(viewData.reduce((max, s) => Math.max(max, s.ageOlder), timelineMin) / 50) * 50);
    $('timedesc').textContent = `Show ${theme.toLowerCase()} cumulatively through ${calendarLabel(timelineMin)}.`;
    $('tickOldest').textContent = theme === 'Archaeology' ? 'Before 8050 BCE' : calendarLabel(timelineMax);
    $('tickMiddleOlder').textContent = calendarLabel(timelineMax - (timelineMax - timelineMin) / 3);
    $('tickMiddleYounger').textContent = calendarLabel(timelineMax - 2 * (timelineMax - timelineMin) / 3);
    $('tickLatest').textContent = calendarLabel(timelineMin);
    threshold = timelineMin;
    $('time').min = timelineMin;
    $('time').max = timelineMax;
    $('time').value = timelineMin;
    refresh();
  $('country').value = 'all';
  document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === name)));
  if (resetMap && map) map.flyTo({ center: [28, 16], zoom: 1.8 });
}

function refresh() {
  const list = visible();
  filteredSites = list;
  $('clearFilters').hidden = !query && country === 'all' && allTime;
  $('filterSummary').textContent = country === 'all' ? 'Filter by country'
    : country === 'unknown' ? 'Country not recorded'
    : data.flatMap(s => s.countries).find(c => c.id === country)?.title || 'Filter by country';
  $('count').textContent = `${list.length} / ${data.filter(s => s.theme === theme).length}`;
  renderSiteRows();
  syncClusterSource();
  if (map?.getLayer('atlas-clusters')) {
    map.setPaintProperty('atlas-clusters', 'circle-color', colors[theme] || colors.Archaeology);
  }
  $('timeLabel').textContent = allTime ? 'All time' : timelineLabel();
  $('time').setAttribute('aria-valuetext', timelineLabel());
  if (selected && !list.some(s => s.id === selected)) {
    selected = null;
    $('detail').hidden = true;
  }
}

function selectSite(id, fly = true) {
  const s = sitesById.get(id);
  if (!s) throw new Error('Unknown site');
  selected = id;
  // Selection does not change the filters. Keep the existing controls and focus.
  for (const button of $('siteRows').children) {
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
  const countryLabel = document.createElement('p');
  countryLabel.className = 'site-country';
  countryLabel.textContent = `Country: ${s.region}`;
  a.append(close, tag, h, date, countryLabel, p);
  const figure = document.createElement('figure');
  figure.className = 'site-image';
  figure.hidden = true;
  a.append(figure);
  wikiImage(s.wikipediaUrls[0]).then(photo => {
    if (!photo || selected !== id || !a.contains(figure)) return;
    const image = document.createElement('img');
    image.src = photo.source;
    image.alt = `Wikipedia article image for ${s.title}`;
    image.decoding = 'async';
    image.onerror = () => { figure.hidden = true; };
    const caption = document.createElement('figcaption');
    const credit = document.createElement('a');
    credit.href = photo.creditUrl;
    credit.textContent = photo.credit || 'Image credits and license';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    caption.append(credit);
    figure.append(image, caption);
    figure.hidden = false;
  });
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
    zoom: 6,
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
      style: token ? 'mapbox://styles/mapbox/dark-v11' : {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
    const currentMap = map;
    map.on('load', () => {
      if (map !== currentMap) return;
      map.addSource('atlas-sites', { type: 'geojson', cluster: true,
        clusterRadius: 25, clusterMaxZoom: 4, data: pointCollection(filteredSites) });
      map._atlasVisibleIds = filteredSites.map(s => s.id);
      map.addLayer({ id: 'atlas-clusters', type: 'circle', source: 'atlas-sites',
        filter: ['has', 'point_count'], paint: {
          'circle-color': colors[theme] || colors.Archaeology,
          'circle-radius': ['step', ['get', 'point_count'], 14, 100, 18, 1000, 22],
          'circle-stroke-width': 2, 'circle-stroke-color': '#152330' } });
      map.addLayer({ id: 'atlas-cluster-count', type: 'symbol', source: 'atlas-sites',
        filter: ['has', 'point_count'], layout: {
          'text-field': ['to-string', ['get', 'point_count_abbreviated']],
          'text-size': 12, 'text-font': [token ? 'Open Sans Regular' : 'Noto Sans Regular'], 'text-allow-overlap': true
        }, paint: { 'text-color': '#152330' } });
      map.addLayer({ id: 'atlas-sites', type: 'circle', source: 'atlas-sites',
        paint: { 'circle-radius': 6, 'circle-color': ['match', ['get', 'category'], 'Battles', colors.Battles, 'Geology', colors.Geology, colors.Archaeology],
          'circle-stroke-width': 2, 'circle-stroke-color': '#152330' },
        filter: ['!', ['has', 'point_count']] });
      map.on('click', 'atlas-clusters', e => {
        const feature = e.features?.[0];
        if (!feature) return;
        // Above clusterMaxZoom every feature is an individual point.
        currentMap.easeTo({ center: feature.geometry.coordinates, zoom: 5, duration: 600 });
      });
      map.on('mouseenter', 'atlas-clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'atlas-clusters', () => { map.getCanvas().style.cursor = ''; });
      map.on('click', 'atlas-sites', e => {
        const id = e.features?.[0]?.properties?.siteId;
        if (sitesById.has(id)) selectSite(id);
      });
      map.on('mouseenter', 'atlas-sites', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'atlas-sites', () => { map.getCanvas().style.cursor = ''; });
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
$('sites').onscroll = () => renderSiteRows();
let timelineCollapsed = false;
$('toggleTimeline').onclick = () => {
  timelineCollapsed = !timelineCollapsed;
  $('timelineControls').hidden = timelineCollapsed;
  $('play').hidden = timelineCollapsed;
  $('alltime').hidden = timelineCollapsed;
  $('timeline').setAttribute('data-collapsed', String(timelineCollapsed));
  $('toggleTimeline').setAttribute('aria-expanded', String(!timelineCollapsed));
  $('toggleTimeline').setAttribute('aria-label', timelineCollapsed ? 'Expand timeline' : 'Collapse timeline');
  $('toggleTimeline').setAttribute('title', timelineCollapsed ? 'Expand timeline' : 'Collapse timeline');
};
$('countrySearch').oninput = e => {
  const text = e.target.value.trim().toLowerCase();
  for (const option of $('country').children) {
    option.hidden = option.value !== 'all' && option.value !== country &&
      !option.textContent.toLowerCase().includes(text);
  }
};
$('clearFilters').onclick = () => {
  stop();
  query = '';
  country = 'all';
  // Keep the current view when clearing filters.
  allTime = true;
  threshold = timelineMin;
  journeyIndex = -1;
  selected = null;
  $('detail').hidden = true;
  $('search').value = '';
  $('countrySearch').value = '';
  $('country').value = 'all';
  for (const option of $('country').children) option.hidden = false;
  $('time').value = timelineMin;
  $('sites').scrollTop = 0;
  document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === theme)));
  refresh();
  if (map) map.flyTo({ center: [28, 16], zoom: 1.8 });
};
$('search').oninput = e => {
  query = e.target.value.toLowerCase().trim();
  $('sites').scrollTop = 0;
  journeyIndex = -1;
  refresh();
};
$('country').onchange = e => {
  country = e.target.value;
  $('sites').scrollTop = 0;
  journeyIndex = -1;
  refresh();
  if (!map) return;
  if (country === 'all') {
    map.flyTo({ center: [28, 16], zoom: 1.8 });
    return;
  }
  if (!filteredSites.length) return;
  // Use the shortest longitude interval, including countries across the dateline.
  const longitudes = filteredSites.map(s => (s.coordinates[0] + 360) % 360).sort((a, b) => a - b);
  let largestGap = -1, start = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = i + 1 < longitudes.length ? longitudes[i + 1] : longitudes[0] + 360;
    if (next - longitudes[i] > largestGap) {
      largestGap = next - longitudes[i];
      start = next % 360;
    }
  }
  const west = start > 180 ? start - 360 : start;
  let south = 90, north = -90;
  for (const s of filteredSites) {
    south = Math.min(south, s.coordinates[1]);
    north = Math.max(north, s.coordinates[1]);
  }
  map.fitBounds([[west, south], [west + 360 - largestGap, north]], {
    padding: { top: 80, bottom: 260, left: 40, right: 40 },
    maxZoom: 6,
    duration: 900
  });
};
document.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => switchView(b.dataset.theme));
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
    const step = theme === 'Archaeology' ? 250 : Math.max(50, Math.ceil((timelineMax - timelineMin) / 32 / 50) * 50);
    threshold = Math.max(timelineMin, threshold - step);
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
  theme = 'Archaeology';
  query = '';
  country = 'all';
  $('country').value = 'all';
  $('search').value = '';
  document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === theme)));
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
    try {
      const battleResponse = await fetch('data/battles.json', { cache: 'no-store' });
      if (!battleResponse.ok) throw new Error('Battles could not load');
      const battleData = await battleResponse.json();
      const battles = importedSites(battleData);
      const existingIds = new Set(data.map(s => s.id));
      data = [...data, ...battles.filter(s => !existingIds.has(s.id))];
    } catch {
      $('categoryStatus').textContent = 'Battle data is unavailable. Archaeology remains available.';
    }
    try {
      const response = await fetch('data/geology.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Geology could not load');
      const geology = importedSites(await response.json());
      data = [...data, ...geology];
    } catch { /* The other views remain usable when optional geology data is missing. */ }
    sitesById = new Map(data.map(s => [s.id, s]));
    for (const s of data) s.searchText = `${s.id} ${s.title} ${s.region} ${s.description}`.toLowerCase();
    switchView('Archaeology', false);
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
          switchView(sitesById.get(input.siteId).theme);
          query = '';
          country = 'all';
          $('country').value = 'all';
          $('search').value = '';
          document.querySelectorAll('[data-theme]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.theme === theme)));
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
