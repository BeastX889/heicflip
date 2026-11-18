import { h, $, fmtBytes, baseName, plural, toast, tick, pickFiles, saveBlob, download, seg, toggle, store, storeRaw, storeSet, dialog } from './ui.js';
import { icon } from './icons.js';
import { convertPhoto, FORMATS, isPhotoName } from './convert.js';
import { zipBlobs } from './zip.js';
import { initTips, onTipsReady, openSupport, countSave, tipLine } from './support.js';
import { isAppWindow, showLanding } from './gate.js';

const VERSION = '1.1.0';
export const APP_NAME = 'Heicflip';
const ACCEPT = '.heic,.heif,.hif,image/heic,image/heif,image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp';
const SIZES = [['0', 'Original'], ['4000', '4000 px'], ['2048', '2048 px'], ['1080', '1080 px']];

const settings = store('settings', { format: 'jpg', quality: 90, maxSide: '0', keepDetails: true, removeLocation: true });
const items = [];
let nextId = 1, running = false, stopRequested = false;

const main = $('#main');

/* ---------------- views ---------------- */
function render() {
  main.innerHTML = '';
  main.className = 'main ' + (items.length ? 'working' : 'empty');
  if (!items.length) return main.append(emptyView());
  main.append(workView());
  refresh();
}

function emptyView() {
  const zone = h('div', { class: 'drop', tabindex: '0', role: 'button', 'aria-label': 'Choose photos to convert' },
    h('span', { html: icon('upload') }).firstChild,
    h('b', {}, 'Choose photos'),
    h('span', {}, 'or drag and drop HEIC photos here. Hundreds at once is fine.'));
  zone.addEventListener('click', openPicker);
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  const feat = (ico, title, text) => h('div', { class: 'feat' }, h('span', { html: icon(ico) }).firstChild, h('div', {}, h('b', {}, title), h('span', {}, text)));
  return h('section', { class: 'hero' },
    h('h1', {}, 'Open your iPhone photos on Windows'),
    h('p', { class: 'lead' }, 'Convert HEIC photos to JPG, PNG or WebP in bulk. Everything happens on your PC: your photos are never uploaded.'),
    zone,
    h('div', { class: 'feats' },
      feat('layers', 'Whole folders at once', 'Drop in hundreds of photos and save them all in one go.'),
      feat('calendar', 'Keeps the date taken', 'Date and camera details move into the JPG, so your photos stay in order.'),
      feat('shield', 'Removes location', 'GPS location is wiped from the copies by default, safe to share.'),
      feat('wifi', 'Works offline', 'No account, no upload, no waiting on the internet.')));
}

let els = {};
function workView() {
  const grid = h('div', { class: 'grid', id: 'grid' });
  const summary = h('div', { class: 'summary' });
  const bar = h('div', { class: 'toolbar' },
    summary,
    h('div', { class: 'grow' }),
    h('button', { class: 'btn', type: 'button', onclick: openPicker, html: icon('plus') + '<span>Add photos</span>' }),
    h('button', { class: 'btn ghost', type: 'button', onclick: clearAll, html: icon('trash') + '<span>Clear</span>' }));

  // settings
  const fmt = seg(Object.entries(FORMATS).map(([k, f]) => [k, f.label]), settings.format, v => change({ format: v }), 'Format');
  const q = h('input', { type: 'range', min: '50', max: '100', step: '1', value: String(settings.quality), 'aria-label': 'Quality' });
  const qVal = h('output', { class: 'qval' }, settings.quality + '%');
  q.addEventListener('input', () => { qVal.textContent = q.value + '%'; });
  q.addEventListener('change', () => change({ quality: +q.value }));
  const size = h('select', { 'aria-label': 'Size' }, SIZES.map(([v, t]) => h('option', { value: v, selected: v === settings.maxSide }, v === '0' ? 'Original size' : `Longest side ${t}`)));
  size.addEventListener('change', () => change({ maxSide: size.value }));
  const keep = toggle('Keep date & camera details', 'Date taken, camera and lens', settings.keepDetails, v => change({ keepDetails: v }));
  const loc = toggle('Remove location', 'Wipe GPS from the copies', settings.removeLocation, v => change({ removeLocation: v }));
  const qRow = h('div', { class: 'set' }, h('span', { class: 'set-l' }, 'Quality'), h('div', { class: 'range' }, q, qVal));
  const detailsNote = h('p', { class: 'fine' }, 'Photo details are kept in JPG files only.');

  const primary = h('button', { class: 'btn primary big', type: 'button', onclick: onPrimary });
  const secondary = h('button', { class: 'btn big', type: 'button', onclick: saveZip, html: icon('zip') + '<span>Download ZIP</span>' });
  const progress = h('div', { class: 'progress', hidden: true }, h('i'));

  const side = h('aside', { class: 'side' },
    h('div', { class: 'card settings' },
      h('h2', {}, 'Convert to'),
      fmt, qRow,
      h('div', { class: 'set' }, h('span', { class: 'set-l' }, 'Size'), size),
      h('div', { class: 'divider' }),
      keep, loc, detailsNote),
    h('div', { class: 'card go' }, primary, secondary, progress));

  els = { grid, summary, primary, secondary, progress, qRow, keep, loc, detailsNote };
  syncSettingsUi();
  const page = h('div', { class: 'work' }, h('section', { class: 'photos' }, bar, grid), side);
  for (const it of items) grid.append(card(it));
  return page;
}

function syncSettingsUi() {
  if (!els.qRow) return;
  els.qRow.hidden = settings.format === 'png';
  const jpg = settings.format === 'jpg';
  els.keep.classList.toggle('off', !jpg);
  els.keep.input.disabled = !jpg;
  els.loc.classList.toggle('off', !jpg || !settings.keepDetails);
  els.loc.input.disabled = !jpg || !settings.keepDetails;
  els.detailsNote.textContent = jpg ? 'Location is only kept if you turn “Remove location” off.' : 'PNG and WebP copies never carry photo details or location.';
}

function card(it) {
  const thumb = h('div', { class: 'thumb' });
  const name = h('b', { title: it.file.name }, it.file.name);
  const meta = h('span', { class: 'meta' });
  const status = h('span', { class: 'status' });
  const save = h('button', { class: 'icon-btn', type: 'button', title: 'Save this photo', 'aria-label': 'Save ' + it.file.name, html: icon('download'), onclick: () => saveOne(it) });
  const remove = h('button', { class: 'icon-btn', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + it.file.name, html: icon('x'), onclick: () => removeItem(it) });
  const el = h('div', { class: 'photo', 'data-id': it.id }, thumb, h('div', { class: 'info' }, name, meta, status), h('div', { class: 'acts' }, save, remove));
  it.el = { root: el, thumb, meta, status, save, remove };
  paintCard(it);
  return el;
}

const extOf = name => (name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase();

function paintCard(it) {
  const e = it.el; if (!e) return;
  e.root.dataset.status = it.status;
  if (it.thumbUrl && !e.thumb.querySelector('img')) { e.thumb.innerHTML = ''; e.thumb.append(h('img', { src: it.thumbUrl, alt: '' })); }
  if (!it.thumbUrl && !e.thumb.firstChild) e.thumb.append(h('span', { class: 'ext' }, extOf(it.file.name) || 'IMG'));
  e.thumb.classList.toggle('stale', it.status === 'waiting' && !!it.thumbUrl);
  const out = it.out;
  e.meta.textContent = out ? `${fmtBytes(it.file.size)} → ${fmtBytes(out.blob.size)} · ${out.width}×${out.height}` : fmtBytes(it.file.size);
  const S = { waiting: ['', 'Ready'], working: ['busy', 'Converting…'], done: ['ok', out?.keptDetails ? 'Done · details kept' : 'Done'], error: ['err', it.error || 'Couldn’t convert'] };
  const [cls, text] = S[it.status];
  e.status.className = 'status ' + cls;
  e.status.textContent = text;
  e.save.hidden = it.status !== 'done';
  e.remove.disabled = it.status === 'working';
}

function refresh() {
  if (!els.summary) return;
  const done = items.filter(i => i.status === 'done');
  const waiting = items.filter(i => i.status === 'waiting');
  const errors = items.filter(i => i.status === 'error');
  const before = items.reduce((s, i) => s + i.file.size, 0);
  const after = done.reduce((s, i) => s + i.out.blob.size, 0);
  els.summary.innerHTML = '';
  els.summary.append(h('b', {}, plural(items.length, 'photo')), ' · ' + fmtBytes(before));
  if (done.length) els.summary.append(h('span', { class: 'arrow' }, ` → ${fmtBytes(after)}`));
  if (errors.length) els.summary.append(h('span', { class: 'bad' }, ` · ${errors.length} couldn’t be converted`));

  const p = els.primary;
  if (running) {
    p.innerHTML = icon('stop') + `<span>Stop</span>`;
    p.className = 'btn big';
    els.secondary.hidden = true;
  } else if (waiting.length) {
    p.innerHTML = `<span>Convert ${plural(waiting.length, 'photo')}</span>`;
    p.className = 'btn primary big';
    els.secondary.hidden = true;
  } else {
    p.innerHTML = icon(window.showDirectoryPicker ? 'folder' : 'download') + `<span>${window.showDirectoryPicker ? 'Save all to a folder' : 'Save all'}</span>`;
    p.className = 'btn primary big';
    p.disabled = !done.length;
    els.secondary.hidden = !window.showDirectoryPicker || done.length < 2;
  }
  if (running || waiting.length) p.disabled = false;
}

/* ---------------- actions ---------------- */
async function openPicker() { addFiles(await pickFiles(ACCEPT)); }

function addFiles(files) {
  const ok = files.filter(f => isPhotoName(f.name) || /^image\//.test(f.type));
  const skipped = files.length - ok.length;
  if (skipped) toast(`${plural(skipped, 'file')} skipped: not a photo.`, ok.length ? '' : 'err');
  if (!ok.length) return;
  const wasEmpty = !items.length;
  for (const file of ok) items.push({ id: nextId++, file, status: 'waiting' });
  if (wasEmpty) render();
  else { for (const it of items.slice(-ok.length)) els.grid.append(card(it)); refresh(); }
}

function removeItem(it) {
  if (it.status === 'working') return;
  const i = items.indexOf(it);
  if (i < 0) return;
  items.splice(i, 1);
  if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  if (!items.length) return render();
  it.el.root.remove();
  refresh();
}

function clearAll() {
  if (running) stopRequested = true;
  for (const it of items) if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
  items.length = 0;
  render();
}

function change(patch) {
  Object.assign(settings, patch);
  storeSet('settings', settings);
  syncSettingsUi();
  // New settings mean new copies: finished photos go back to "ready" (their preview stays).
  let changed = false;
  for (const it of items) if (it.status === 'done' || it.status === 'error') { it.status = 'waiting'; it.out = null; it.error = null; paintCard(it); changed = true; }
  if (changed) toast('Settings changed. Convert again to apply them.');
  refresh();
}

function onPrimary() {
  if (running) { stopRequested = true; return; }
  if (items.some(i => i.status === 'waiting')) return convertAll();
  return saveAll();
}

async function convertAll() {
  running = true; stopRequested = false;
  const queue = items.filter(i => i.status === 'waiting');
  els.progress.hidden = false;
  const bar = els.progress.firstChild;
  refresh();
  const opts = { format: settings.format, quality: settings.quality / 100, maxSide: +settings.maxSide, keepDetails: settings.keepDetails, removeLocation: settings.removeLocation };
  let n = 0, next = 0;
  // Two photos at a time: while one is being decoded, the other is being saved.
  const LANES = Math.min(3, Math.max(2, Math.floor((navigator.hardwareConcurrency || 2) / 3)));
  const lane = async k => {
    while (next < queue.length && !stopRequested) {
      const it = queue[next++];
      if (!items.includes(it)) continue;
      it.status = 'working'; paintCard(it);
      it.el.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      try {
        const out = await convertPhoto(it.file, { ...opts, lane: k });
        if (!items.includes(it) || it.status !== 'working') continue;
        it.out = out;
        if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
        it.thumbUrl = URL.createObjectURL(out.thumb);
        it.el.thumb.innerHTML = '';
        it.status = 'done';
      } catch (e) {
        console.warn(it.file.name, e);
        if (it.status !== 'working') continue;
        it.status = 'error';
        it.error = /photo this app can open|WebP/.test(e?.message || '') ? e.message : 'Couldn’t read this photo';
      }
      paintCard(it);
      bar.style.width = Math.round(++n / queue.length * 100) + '%';
      refresh();
      await tick();
    }
  };
  await Promise.all(Array.from({ length: LANES }, (_, k) => lane(k)));
  running = false;
  els.progress.hidden = true; bar.style.width = '0%';
  refresh();
  const done = items.filter(i => i.status === 'done').length;
  if (stopRequested) toast('Stopped.');
  else if (done) toast(`${plural(done, 'photo')} ready to save.`);
}

const outName = it => `${baseName(it.file.name)}.${FORMATS[settings.format].ext}`;

async function saveOne(it) {
  if (!it.out) return;
  const name = await saveBlob(it.out.blob, outName(it), FORMATS[settings.format].label + ' image');
  if (name) { toast('Saved ' + name); afterSave(); }
}

async function saveAll() {
  const done = items.filter(i => i.status === 'done');
  if (!done.length) return;
  if (done.length === 1) return saveOne(done[0]);
  if (!window.showDirectoryPicker) return saveZip();
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'heicflip-out', startIn: 'pictures' }); }
  catch (e) { if (e?.name !== 'AbortError') saveZip(); return; }
  els.progress.hidden = false;
  const bar = els.progress.firstChild;
  let saved = 0;
  try {
    for (const it of done) {
      const name = await freeName(dir, outName(it));
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(it.out.blob); await w.close();
      bar.style.width = Math.round(++saved / done.length * 100) + '%';
    }
    toast(`Saved ${plural(saved, 'photo')} to “${dir.name}”.`); afterSave();
  } catch (e) {
    console.error(e);
    toast(`Saved ${saved} of ${done.length}. Windows refused the rest: try another folder.`, 'err');
  } finally {
    els.progress.hidden = true; bar.style.width = '0%';
  }
}

// Never overwrite a file that is already in the folder: "IMG_1234 (2).jpg" instead.
async function freeName(dir, name) {
  let candidate = name, k = 2;
  for (;;) {
    try { await dir.getFileHandle(candidate); } catch { return candidate; }
    candidate = name.replace(/(\.[^.]+)?$/, m => ` (${k++})${m}`);
  }
}

async function saveZip() {
  const done = items.filter(i => i.status === 'done');
  if (!done.length) return;
  els.progress.hidden = false;
  const bar = els.progress.firstChild;
  try {
    const zip = await zipBlobs(done.map(it => ({ name: outName(it), blob: it.out.blob })), f => { bar.style.width = Math.round(f * 100) + '%'; });
    const name = await saveBlob(zip, `converted-photos-${new Date().toISOString().slice(0, 10)}.zip`, 'ZIP archive');
    if (name) { toast('Saved ' + name); afterSave(); }
  } catch (e) {
    console.error(e);
    toast('Couldn’t make the ZIP. Try saving to a folder instead.', 'err');
  } finally { els.progress.hidden = true; bar.style.width = '0%'; }
}

/* ---------------- about ---------------- */
function about() {
  dialog('About Heicflip', h('div', { class: 'about' },
    h('p', {}, 'Heicflip converts HEIC photos from iPhones and iPads into JPG, PNG or WebP. Every photo is converted on your own PC: nothing is uploaded, and it works without an internet connection.'),
    h('p', {}, 'Heicflip is free, with no ads and nothing locked. If it saves you time, you can leave an optional tip through the Microsoft Store.'),
    h('p', {}, h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy policy'), ' · ', h('a', { href: 'mailto:lumiolabsdev99@gmail.com' }, 'Contact support')),
    h('p', { class: 'fine' }, `Version ${VERSION} · © 2026 LumioLab`),
    h('p', { class: 'fine' }, 'HEIC decoding uses libheif and heic-to, used under the GNU LGPL 3.0. ',
      h('a', { href: 'https://github.com/strukturag/libheif', target: '_blank', rel: 'noopener' }, 'libheif source'), ' · ',
      h('a', { href: 'https://github.com/hoppergee/heic-to', target: '_blank', rel: 'noopener' }, 'heic-to source'), ' · ',
      h('a', { href: 'vendor/heic-to-LICENSE.txt', target: '_blank', rel: 'noopener' }, 'licence'))));
}

/* ---------------- theme ---------------- */
const THEMES = ['system', 'light', 'dark'];
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const btn = $('#themeBtn');
  btn.innerHTML = icon(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'auto');
  btn.title = btn.ariaLabel = `Theme: ${t === 'system' ? 'match Windows' : t}`;
}
let theme = storeRaw('theme', 'system');
applyTheme(theme);
$('#themeBtn').addEventListener('click', () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; storeSet('theme', theme); applyTheme(theme); });
$('#aboutBtn').innerHTML = icon('info');
$('#aboutBtn').addEventListener('click', about);

/* ---------------- drag & drop anywhere, keyboard, file handler ---------------- */
const veil = $('#dropveil');
let depth = 0;
window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { depth++; veil.hidden = false; } });
window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; veil.hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', async e => {
  e.preventDefault(); depth = 0; veil.hidden = true;
  addFiles(await filesFromDrop(e.dataTransfer));
});
// Folders dropped in are walked for photos.
async function filesFromDrop(dt) {
  const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.some(en => en.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async en => {
    if (en.isFile) { out.push(await new Promise(r => en.file(r, () => r(null)))); return; }
    const reader = en.createReader();
    for (;;) {
      const batch = await new Promise(r => reader.readEntries(r, () => r([])));
      if (!batch.length) break;
      for (const b of batch) await walk(b);
    }
  };
  for (const en of entries) await walk(en);
  return out.filter(Boolean);
}
window.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(); }
});
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    if (!params.files?.length) return;
    addFiles(await Promise.all(params.files.map(f => f.getFile())));
  });
}
window.addEventListener('beforeunload', e => {
  if (running) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------- optional tips ---------------- */
// One quiet thank-you line under the Save buttons at a few save milestones (3, 10, 25…), never a pop-up.
function afterSave() {
  if (!countSave()) return;
  const go = document.querySelector('.card.go');
  if (go && !go.querySelector('.tip-line')) go.append(tipLine());
}

if (!isAppWindow()) {
  showLanding({
    name: APP_NAME, tagline: 'HEIC to JPG Converter', icon: 'icons/icon-192.png',
    storeUrl: '',
    blurb: 'Convert iPhone HEIC photos to JPG, PNG or WebP in bulk. Keeps the date taken, removes location, and every photo stays on your PC.',
    features: [
      ['Hundreds at once', 'Drop a whole folder of iPhone photos and convert them in one go.'],
      ['Keeps the details', 'Date taken, camera and lens are copied into each JPG.'],
      ['Private', 'Location is wiped by default, and nothing is ever uploaded.'],
      ['Save your way', 'Save into a folder or download everything as one ZIP.'],
    ],
  });
} else {
  render();
  $('#supportBtn').addEventListener('click', openSupport);
  onTipsReady(() => { $('#supportBtn').hidden = false; });
  initTips(APP_NAME);
}

const devHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
if ('serviceWorker' in navigator && !devHost) navigator.serviceWorker.register('sw.js').catch(() => {});
// Test hook (local only).
if (devHost) window.__heicflip = { items, settings, addFiles };
