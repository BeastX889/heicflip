// Small DOM + UI helpers.
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  if (n < 1024 ** 3) return (n / 1024 / 1024).toFixed(n < 10485760 ? 2 : 1) + ' MB';
  return (n / 1024 ** 3).toFixed(2) + ' GB';
}
export const baseName = name => name.replace(/\.[^.]+$/, '');
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3200);
}

export const tick = () => new Promise(r => setTimeout(r, 0));

export function pickFiles(accept) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, multiple: true, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

/** Native "Save as" where available (Edge/Chrome on Windows), else a normal download. */
export async function saveBlob(blob, name, desc = 'File') {
  const ext = name.split('.').pop().toLowerCase();
  if (window.showSaveFilePicker && window.top === window) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [blob.type]: ['.' + ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      return handle.name;
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
    }
  }
  download(blob, name);
  return name;
}
export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function seg(options, value, onChange, label) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  const btns = options.map(([v, text]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value) }, text);
    b.addEventListener('click', () => {
      btns.forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      el.value = v; onChange && onChange(v);
    });
    return b;
  });
  el.value = value;
  el.append(...btns);
  return el;
}

export function toggle(label, hint, checked, onChange) {
  const inp = h('input', { type: 'checkbox', role: 'switch', checked: !!checked });
  inp.addEventListener('change', () => onChange(inp.checked));
  const el = h('label', { class: 'switch' }, h('span', { class: 'sw-txt' }, h('b', {}, label), hint ? h('small', {}, hint) : null), inp, h('i', { 'aria-hidden': 'true' }));
  el.input = inp;
  return el;
}

const KEY = 'heicflip.';
export function store(key, fallback) {
  try { const v = localStorage.getItem(KEY + key); return v == null ? fallback : { ...fallback, ...JSON.parse(v) }; }
  catch { return fallback; }
}
export function storeRaw(key, fallback) {
  try { const v = localStorage.getItem(KEY + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function storeSet(key, v) { try { localStorage.setItem(KEY + key, JSON.stringify(v)); } catch { /* private mode */ } }

export function dialog(title, body, { ok = 'Close' } = {}) {
  const dlg = document.getElementById('dlg');
  dlg.innerHTML = '';
  dlg.append(h('form', { method: 'dialog' },
    h('div', { class: 'dlg-head' }, title),
    h('div', { class: 'dlg-body' }, body),
    h('div', { class: 'dlg-foot' }, h('button', { class: 'btn primary', type: 'submit' }, ok))));
  dlg.showModal();
}
