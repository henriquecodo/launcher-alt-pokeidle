/**
 * Interface do launcher: cria um card (<webview>) por conta, mostra XP/h, sessão e RAM,
 * e repassa ao jogo só os cliques que você fizer (automações, abas, zoom).
 */
const GAME_URL = 'https://pokeidle.io/app';
const GUIDE_URL = 'https://guiapokeidlehardtocapture.site/';
const MAX = 4;

const AUTOS = [
  { id: 'auto-ball-captura', icon: 'target', label: 'Lançar até capturar' },
  { id: 'auto-ball-sem-parar', icon: 'repeat', label: 'Lançar sem parar' },
  { id: 'auto-revive', icon: 'heart', label: 'Usar revive ao desmaiar' },
  { id: 'auto-potion', icon: 'flask', label: 'Usar poções' },
  { id: 'auto-voltar-hunt', icon: 'undo', label: 'Voltar à hunt ao morrer' },
];
const NAV = ['Pokédex', 'Mapa', 'Market', 'Passe', 'Ranks', 'Boss', 'PvP', 'Ginásio', 'Torneio', 'Casa', 'Shop', 'Wiki'];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

let cfg;
const panels = new Array(MAX).fill(null); // conta desligada = null (sem webview, sem RAM)
const live = () => panels.filter(Boolean);
const online = () => live().filter((p) => p.state && p.state.loggedIn);

// ---------- Config ----------
const DEFAULT_NAME = /^(Principal|Alt \d|Conta \d)$/;
const defaultAccount = (i) => ({ name: i === 0 ? 'Principal' : `Alt ${i}`, zoom: null, desired: {} });
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.launcher.saveCfg(cfg), 300);
}
const saveNow = () => { clearTimeout(saveTimer); return window.launcher.saveCfg(cfg); };

// ---------- Formatação ----------
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
const fmtMb = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : Math.round(mb) + ' MB');

// ---------- Tooltip e aviso ----------
const tip = document.createElement('div');
tip.id = 'tip';
document.body.appendChild(tip);
let tipTimer, tipEl;
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t === tipEl) return;
  tipEl = t;
  clearTimeout(tipTimer);
  tip.classList.remove('show');
  if (!t || document.querySelector('.pop.open')) return;
  tipTimer = setTimeout(() => {
    tip.textContent = t.dataset.tip;
    const r = t.getBoundingClientRect();
    const w = tip.offsetWidth;
    tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    tip.style.top = r.bottom + 8 + 'px';
    tip.classList.add('show');
  }, 450);
});
document.addEventListener('mousedown', () => { clearTimeout(tipTimer); tip.classList.remove('show'); });

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- XP ----------
// "4.477.283 / 7.580.700 xp" -> { cur, max }
function parseXp(t) {
  const m = String(t).match(/([\d.]+)\s*\/\s*([\d.]+)/);
  return m ? { cur: +m[1].replace(/\./g, ''), max: +m[2].replace(/\./g, '') } : null;
}
// Acumula XP ganho (tratando level-up) e guarda amostras dos últimos 10 min.
function pushXp(p, xp) {
  const now = Date.now();
  if (p.lastXp) {
    let d = xp.cur - p.lastXp.cur;
    if (d < 0) d = p.lastXp.max - p.lastXp.cur + xp.cur; // subiu de nível
    p.gained += d;
  }
  p.lastXp = xp;
  p.samples.push([now, p.gained]);
  while (p.samples.length && now - p.samples[0][0] > 10 * 60e3) p.samples.shift();
}
function xpPerHour(p) {
  if (p.samples.length < 2) return null;
  const [t0, g0] = p.samples[0];
  const [t1, g1] = p.samples[p.samples.length - 1];
  return t1 - t0 < 30e3 ? null : ((g1 - g0) / (t1 - t0)) * 3600e3;
}

// ---------- Ações no jogo ----------
const js = (p, code) => (p.ready ? p.wv.executeJavaScript(code).catch(() => null) : Promise.resolve(null));
const setAuto = (p, id, want) =>
  js(p, `(()=>{const e=document.getElementById(${JSON.stringify(id)});if(e&&e.checked!==${!!want})e.click()})()`);
const navTo = (p, label) =>
  js(p, `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===${JSON.stringify(label)});if(b)b.click()})()`);

function toggleAuto(p, id, value) {
  const acc = cfg.accounts[p.idx];
  const cur = !!(p.state && p.state.auto && p.state.auto[id]);
  const v = value === undefined ? !cur : value;
  acc.desired[id] = v;
  if (p.state && p.state.auto) p.state.auto[id] = v; // resposta visual imediata
  save();
  setAuto(p, id, v);
  renderPanel(p);
  renderAllAutos();
}

// ---------- Zoom automático ----------
// Tamanho em que a HUD do jogo cabe inteira; o zoom escala o jogo para caber no card.
const GAME_W = 1300, GAME_H = 720;
function effZoom(p) {
  const z = cfg.accounts[p.idx].zoom;
  if (z) return z;
  const r = $('.card-body', p.el).getBoundingClientRect();
  if (!r.width || !r.height) return 0.6;
  return Math.min(1.5, Math.max(0.3, +Math.min(r.width / GAME_W, r.height / GAME_H).toFixed(2)));
}
function applyZoom(p) {
  const z = effZoom(p);
  if (p.lastZoom === z) return;
  p.lastZoom = z;
  try { p.wv.setZoomFactor(z); } catch {}
}

// ---------- Render ----------
function setIcon(el, name) {
  if (el.dataset.icon === name) return;
  el.dataset.icon = name;
  el.innerHTML = svgIcon(name);
}

function renderPanel(p) {
  const s = p.state, el = p.el, acc = cfg.accounts[p.idx];
  const on = !!(s && s.loggedIn);
  el.classList.toggle('live', on);
  el.classList.toggle('login', !!(s && !s.loggedIn));
  $('.state', el).textContent = p.queued ? 'na fila…' : !s ? 'carregando…' : on ? '' : 'faça login';
  $('.lvl', el).textContent = on && s.level ? s.level.replace(/^\D*/, 'Nv ') : '';
  const x = xpPerHour(p);
  $('.xph b', el).textContent = x == null ? '—' : fmt(x);
  $('.sess', el).textContent = p.gained ? '+' + fmt(p.gained) : '';
  $$('.ab', el).forEach((b) => {
    const v = s && s.auto ? s.auto[b.dataset.id] : null;
    b.disabled = !on || v === null;
    b.classList.toggle('on', !!v);
  });
  $('.eco', el).classList.toggle('on', acc.eco === true);
  const mute = $('.mute', el);
  mute.classList.toggle('on', p.muted);
  setIcon($('.ic', mute), p.muted ? 'mute' : 'volume');
  const focused = el.classList.contains('focused');
  setIcon($('.focus .ic', el), focused ? 'shrink' : 'expand');
  const zv = $('.zv', el);
  zv.textContent = Math.round(effZoom(p) * 100) + '%';
  zv.classList.toggle('manual', !!acc.zoom);
  zv.dataset.tip = acc.zoom ? 'Zoom manual — clique para voltar ao automático' : 'Zoom automático: ajusta o jogo ao tamanho do card';
  const name = $('.name', el);
  if (document.activeElement !== name) name.value = acc.name;
}

function renderTotals() {
  let sum = 0, any = false, sess = 0;
  for (const p of live()) {
    const x = xpPerHour(p);
    if (x != null) { sum += x; any = true; }
    sess += p.gained;
  }
  $('#st-xph').textContent = any ? fmt(sum) : '—';
  $('#st-sess').textContent = sess ? '+' + fmt(sess) : '—';
}

function renderAllAutos() {
  const ps = online();
  $$('#all-autos .item').forEach((row) => {
    const id = row.dataset.id;
    const n = ps.filter((p) => p.state.auto[id]).length;
    const sw = $('.switch', row);
    sw.checked = ps.length > 0 && n === ps.length;
    sw.disabled = ps.length === 0;
    $('.count', row).textContent = ps.length ? `${n} de ${ps.length}` : 'nenhuma online';
  });
}

function renderGrid() {
  const g = $('#grid');
  g.dataset.n = cfg.count;
  g.className = (cfg.layout || 'auto') + ($('.card.focused') ? ' focus' : '');
  $$('#seg-count button').forEach((b) => b.classList.toggle('on', +b.dataset.n === cfg.count));
  $('.seg-thumb').style.transform = `translateX(${(cfg.count - 1) * 30}px)`;
}

function paintMuteAll() {
  const btn = $('#btn-mute-all');
  const all = live().length > 0 && live().every((p) => p.muted);
  btn.classList.toggle('muted', all);
  setIcon($('.ic', btn), all ? 'mute' : 'volume');
  $('span', btn).textContent = all ? 'Sem som' : 'Som';
}

// ---------- Estado vindo do jogo ----------
function onState(p, st) {
  const prev = p.state;
  p.state = st;
  const xp = parseXp(st.xpText);
  if (st.loggedIn && xp) pushXp(p, xp);
  const acc = cfg.accounts[p.idx];
  // Nome padrão? usa o nick do jogo.
  if (st.loggedIn && st.nick && DEFAULT_NAME.test(acc.name)) { acc.name = st.nick.slice(0, 20); save(); }
  // Você abriu a ficha de um pokémon no jogo: guarda para "Melhores hunts".
  if (st.ficha) onFicha(p, st.ficha);
  // Acabou de logar: reaplica as automações escolhidas no launcher.
  if (st.loggedIn && !(prev && prev.loggedIn)) {
    setTimeout(() => AUTOS.forEach(({ id }) => id in acc.desired && setAuto(p, id, acc.desired[id])), 2500);
  }
  renderPanel(p);
  renderTotals();
  renderAllAutos();
}

// ---------- Cards ----------
// Abrir as 4 contas no mesmo instante sobrecarrega a checagem de login e o captcha (Cloudflare),
// além de criar um pico de CPU/RAM. Na abertura do launcher, cada conta entra alguns segundos depois da anterior.
const STAGGER_MS = 3000;

function buildPanel(i, delay = 0) {
  const acc = cfg.accounts[i];
  const el = $('#panel-tpl').content.firstElementChild.cloneNode(true);
  el.style.order = i;
  hydrateIcons(el);
  const wv = document.createElement('webview');
  wv.setAttribute('partition', `persist:conta${i + 1}`); // login/dados isolados por conta
  wv.setAttribute('src', GAME_URL); // o preload e as travas de segurança são impostos pelo main.js

  const p = { idx: i, el, wv, huntsCache: null, ready: false, queued: delay > 0, state: null, samples: [], gained: 0, lastXp: null, muted: !!acc.muted, lastZoom: null, hotCount: 0 };
  panels[i] = p;
  const attach = () => { p.queued = false; if (panels[i] === p) $('.card-body', el).appendChild(wv); renderPanel(p); };
  if (delay) setTimeout(attach, delay);

  const autos = $('.autos', el);
  for (const a of AUTOS) {
    const b = document.createElement('button');
    b.className = 'ab';
    b.dataset.id = a.id;
    b.dataset.tip = a.label;
    b.innerHTML = `<i class="ic">${svgIcon(a.icon)}</i>`;
    b.onclick = () => toggleAuto(p, a.id);
    autos.appendChild(b);
  }

  const name = $('.name', el);
  name.value = acc.name;
  name.addEventListener('input', () => { acc.name = name.value.trim() || `Conta ${i + 1}`; save(); });
  name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur());

  wv.addEventListener('dom-ready', () => { p.ready = true; p.lastZoom = null; applyZoom(p); if (p.muted) wv.setAudioMuted(true); });
  wv.addEventListener('did-start-loading', () => { p.state = null; renderPanel(p); });
  wv.addEventListener('ipc-message', (e) => e.channel === 'state' && onState(p, e.args[0]));
  // O jogo desta conta caiu (falta de memória, travamento...): só este card recarrega, o resto segue.
  wv.addEventListener('render-process-gone', (e) => {
    if (e.reason === 'clean-exit' || panels[i] !== p) return;
    p.ready = false;
    p.state = null;
    renderPanel(p);
    toast(`${acc.name}: o jogo travou — recarregando a conta`);
    setTimeout(() => { if (panels[i] === p) wv.reload(); }, 2000);
  });

  const setZoom = (z) => { acc.zoom = z; applyZoom(p); renderPanel(p); save(); };
  $('.zin', el).onclick = () => setZoom(Math.min(2, +(effZoom(p) + 0.05).toFixed(2)));
  $('.zout', el).onclick = () => setZoom(Math.max(0.3, +(effZoom(p) - 0.05).toFixed(2)));
  $('.zv', el).onclick = () => setZoom(null);
  let rt;
  new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { applyZoom(p); renderPanel(p); }, 150); }).observe($('.card-body', el));

  $('.reload', el).onclick = () => reloadPanel(p);
  $('.home', el).onclick = () => p.ready && wv.loadURL(GAME_URL);
  $('.mute', el).onclick = () => { setMuted(p, !p.muted); paintMuteAll(); save(); };
  $('.eco', el).onclick = async () => {
    acc.eco = acc.eco !== true;
    await saveNow(); // o preload lê a config ao recarregar
    toast(`${acc.name}: Modo Economia ${acc.eco ? 'ligado' : 'desligado'} — recarregando`);
    reloadPanel(p);
  };
  $('.hunts', el).onclick = () => toggleSheet(p);
  $('.focus', el).onclick = () => {
    const on = !el.classList.contains('focused');
    $$('.card').forEach((x) => x.classList.remove('focused'));
    el.classList.toggle('focused', on);
    renderGrid();
    live().forEach(renderPanel);
  };

  $('#grid').appendChild(el);
  if (!delay) attach();
  renderPanel(p);
}

const reloadPanel = (p) => p.ready && p.wv.reload();

// Mudo = som do launcher cortado + som do jogo desligado (o jogo deixa de tocar e decodificar áudio).
function setMuted(p, m) {
  p.muted = cfg.accounts[p.idx].muted = m;
  if (p.ready) {
    p.wv.setAudioMuted(m);
    p.wv.send('prefs', { 'cfg-som': m ? '0' : '1' });
  }
  renderPanel(p);
}

function destroyPanel(i) {
  const p = panels[i];
  if (!p) return;
  p.el.remove(); // remove o webview => o processo da conta é encerrado e a RAM liberada
  panels[i] = null;
}

function setCount(n, announce, stagger) {
  cfg.count = Math.max(1, Math.min(MAX, n));
  let k = 0;
  for (let i = 0; i < MAX; i++) {
    if (i >= cfg.count) destroyPanel(i);
    else if (!panels[i]) buildPanel(i, stagger ? k++ * STAGGER_MS : 0);
  }
  renderGrid();
  renderTotals();
  renderAllAutos();
  paintMuteAll();
  save();
  if (announce) toast(cfg.count === 1 ? 'Rodando 1 conta' : `Rodando ${cfg.count} contas`);
}

// ---------- RAM ----------
async function pollMemory() {
  let m;
  try { m = await window.launcher.metrics(); } catch { return; }
  const limit = cfg.ramLimit || 0;
  $('#st-ram').textContent = fmtMb(m.total);
  live().forEach((p) => {
    const mb = m.accounts[p.idx] || 0;
    const hot = !!(limit && mb > limit);
    const r = $('.ram', p.el);
    r.textContent = mb ? fmtMb(mb) : '';
    r.classList.toggle('hot', hot);
    p.hotCount = hot ? p.hotCount + 1 : 0;
    if (p.hotCount >= 2) { // reload mantém login e reaplica automações
      p.hotCount = 0;
      toast(`${cfg.accounts[p.idx].name} passou do limite de RAM — recarregando`);
      reloadPanel(p);
    }
  });
}

// ---------- Barra de ferramentas ----------
function closePops() {
  $$('.pop').forEach((x) => x.classList.remove('open'));
  $$('[data-pop]').forEach((x) => x.classList.remove('open'));
}

function bindToolbar() {
  hydrateIcons();

  $$('[data-pop]').forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const pop = $('#' + b.dataset.pop);
    const open = !pop.classList.contains('open');
    closePops();
    if (open) { pop.classList.add('open'); b.classList.add('open'); renderAllAutos(); }
  }));
  $$('.pop').forEach((p) => p.addEventListener('click', (e) => e.stopPropagation()));
  document.addEventListener('click', closePops);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closePops());

  // Automações em massa
  const box = $('#all-autos');
  for (const a of AUTOS) {
    const row = document.createElement('label');
    row.className = 'item';
    row.dataset.id = a.id;
    row.innerHTML = `<i class="ic">${svgIcon(a.icon)}</i><div><b>${a.label}</b><small class="count"></small></div><input type="checkbox" class="switch">`;
    $('.switch', row).onchange = (e) => {
      const ps = online();
      ps.forEach((p) => toggleAuto(p, a.id, e.target.checked));
      toast(`${a.label}: ${e.target.checked ? 'ligado' : 'desligado'} em ${ps.length} conta${ps.length > 1 ? 's' : ''}`);
    };
    box.appendChild(row);
  }

  // Ir para
  const nav = $('#nav-grid');
  for (const label of NAV) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => {
      const f = panels.find((p) => p && p.el.classList.contains('focused'));
      (f ? [f] : online()).forEach((p) => navTo(p, label));
      closePops();
    };
    nav.appendChild(b);
  }

  $$('#seg-count button').forEach((b) => (b.onclick = () => setCount(+b.dataset.n, true)));
  $('#btn-reset-sess').onclick = () => {
    live().forEach((p) => { p.gained = 0; p.samples = []; p.lastXp = null; renderPanel(p); });
    renderTotals();
    toast('Sessão zerada');
  };
  $('#btn-reload-all').onclick = () => { live().forEach(reloadPanel); toast('Atualizando todas as contas'); };
  $('#btn-guide').onclick = () => window.launcher.openExternal(GUIDE_URL);
  $('#btn-mute-all').onclick = () => {
    const m = !live().every((p) => p.muted);
    live().forEach((p) => setMuted(p, m));
    paintMuteAll();
    save();
  };

  // Ajustes
  $('#cfg-otim').checked = cfg.forceOtim !== false;
  $('#cfg-night').checked = cfg.forceNight !== false;
  $('#cfg-track').checked = cfg.blockTrackers !== false;
  $('#cfg-track').onchange = (e) => { cfg.blockTrackers = e.target.checked; save(); toast('Vale na próxima vez que abrir o launcher'); };
  $('#cfg-keep').checked = cfg.keepLogin !== false;
  $('#cfg-keep').onchange = (e) => {
    cfg.keepLogin = e.target.checked;
    save();
    toast(e.target.checked ? 'As contas continuarão logadas ao reabrir' : 'Ao reabrir, o login dependerá só do jogo');
  };
  $('#cfg-otim').onchange = (e) => { cfg.forceOtim = e.target.checked; save(); };
  $('#cfg-night').onchange = (e) => { cfg.forceNight = e.target.checked; save(); };
  $('#cfg-layout').value = cfg.layout;
  $('#cfg-layout').onchange = (e) => { cfg.layout = e.target.value; renderGrid(); save(); };
  $('#cfg-ram').value = String(cfg.ramLimit);
  $('#cfg-ram').onchange = (e) => { cfg.ramLimit = +e.target.value; save(); };
}

// ---------- Início ----------
(async function init() {
  const saved = (await window.launcher.loadCfg()) || {};
  cfg = { count: MAX, layout: 'auto', ramLimit: 2000, forceOtim: true, forceNight: true, ...saved };
  cfg.accounts = Array.from({ length: MAX }, (_, i) => ({ ...defaultAccount(i), ...((saved.accounts || [])[i] || {}) }));
  if (!cfg.v || cfg.v < 3) { // migração das versões anteriores
    cfg.accounts.forEach((a) => (a.zoom = null));
    if (!['auto', 'row', 'col'].includes(cfg.layout)) cfg.layout = 'auto';
    cfg.forceOtim = cfg.forceNight = true;
    cfg.v = 3;
  }
  await saveNow(); // o preload já lê as preferências na primeira carga
  bindToolbar();
  setCount(cfg.count, false, true);
  setInterval(() => { live().forEach(renderPanel); renderTotals(); }, 5000);
  setInterval(pollMemory, 30000);
  setTimeout(pollMemory, 6000);
})();
