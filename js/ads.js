// The ad space. One quiet box beside the settings, never pop-ups, never over the photos.
// - When an ad network is set up below and the PC is online, it shows a real ad.
// - Otherwise it shows a small card for another LumioLab app, so the space is never empty or broken.
import { h } from './ui.js';

// Fill these in once the ad account is approved (Google AdSense: ca-pub-… and the ad unit's slot id).
export const ADS = { client: '', slot: '' };

const HOUSE = [
  { name: 'Inkfold', line: 'Sign, merge and compress PDFs. Free, offline, no uploads.', url: 'https://beastx889.github.io/inkfold/', color: '#4f46e5', glyph: 'PDF' },
  { name: 'Muscle Atlas 3D', line: 'Explore every muscle in 3D, right in your browser.', url: 'https://beastx889.github.io/muscle-atlas-3d/', color: '#c2410c', glyph: '3D' },
  { name: 'Nutrition Atlas 3D', line: 'A galaxy of 28 nutrients: what they do and where to find them.', url: 'https://beastx889.github.io/nutrition-3d/', color: '#0f766e', glyph: 'Nu' },
];

let scriptAdded = false;
function addAdScript() {
  if (scriptAdded) return;
  scriptAdded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(ADS.client);
  s.crossOrigin = 'anonymous';
  document.head.append(s);
}

function houseCard() {
  const p = HOUSE[Math.floor(Math.random() * HOUSE.length)];
  return h('a', { class: 'house', href: p.url, target: '_blank', rel: 'noopener' },
    h('span', { class: 'house-ico', style: { background: p.color } }, p.glyph),
    h('span', { class: 'house-txt' }, h('b', {}, p.name), h('span', {}, p.line)),
    h('span', { class: 'house-go' }, 'Open'));
}

/** Returns the ad box element. Safe to call again: each call makes a fresh box. */
export function adBox() {
  const box = h('aside', { class: 'adbox', 'aria-label': 'Advertisement' }, h('div', { class: 'adlabel' }, 'Sponsored'));
  const real = ADS.client && ADS.slot && navigator.onLine;
  if (!real) { box.append(houseCard()); return box; }
  const ins = h('ins', { class: 'adsbygoogle', style: { display: 'block' }, 'data-ad-client': ADS.client, 'data-ad-slot': ADS.slot, 'data-ad-format': 'auto', 'data-full-width-responsive': 'true' });
  box.append(ins);
  addAdScript();
  requestAnimationFrame(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ } });
  // If no ad arrives (blocked, offline, no fill), fall back to the house card.
  setTimeout(() => {
    if (!ins.isConnected) return;
    if (ins.getAttribute('data-ad-status') !== 'filled' && ins.offsetHeight < 20) { ins.remove(); box.append(houseCard()); }
  }, 4000);
  return box;
}
