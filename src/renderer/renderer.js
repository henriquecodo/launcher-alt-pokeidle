/**
 * Interface do launcher: cria um card (<webview>) por conta, mostra XP/h, sessão e RAM,
 * e repassa ao jogo só os cliques que você fizer (automações, abas, zoom).
 */
const GAME_URL = 'https://pokeidle.io/app';
const MAX = 4;
const IDLE_MS = 10 * 60e3;      // sem mexer na conta há 10 min = pode recarregar sozinho
const STALL_MS = 15 * 60e3;     // XP parado há 15 min (depois de já ter subido) = conta travada
const DEAD_MS = 90e3;           // 90 s sem nenhuma mensagem do servidor = conexão caída (o jogo pinga a cada 25 s)
const POKE_WAIT_MS = 60e3;      // depois do cutucão, espera 1 min antes de recarregar

const AUTOS = [
  { id: 'auto-ball-captura', icon: 'target', label: 'Lançar até capturar' },
  { id: 'auto-ball-sem-parar', icon: 'repeat', label: 'Lançar sem parar' },
  { id: 'auto-revive', icon: 'heart', label: 'Usar revive ao desmaiar' },
  { id: 'auto-potion', icon: 'flask', label: 'Usar poções' },
  { id: 'auto-voltar-hunt', icon: 'undo', label: 'Voltar à hunt ao morrer' },
];
const NAV = ['Pokedex', 'Mapa', 'Market', 'Passe', 'Ranks', 'Boss', 'PvP', 'Ginásio', 'Torneio', 'Mini Games', 'Casa', 'Shop', 'Wiki'];

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
    if (d > 0) { p.lastXpChange = now; p.farming = true; }
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
// Compara sem acento e sem caixa: o jogo já trocou "Pokédex" por "Pokedex" e muda rótulos entre versões.
const navTo = (p, label) =>
  js(p, `(()=>{const n=(t)=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();const w=n(${JSON.stringify(label)});const bs=[...document.querySelectorAll('button')].filter(b=>n(b.innerText)===w);const b=bs.find(b=>b.offsetParent!==null)||bs[0];if(b)b.click()})()`);

// Modo Economia (sem cena) pelos botões do PRÓPRIO jogo — "Economia" na hunt/arena para ligar,
// "Ligar a cena" para desligar. Assim o jogo fica sempre coerente. Se o botão não estiver na tela
// (ex.: no Centro Pokémon), grava a escolha e recarrega a conta, que já abre no modo certo.
async function setEco(p, want, quiet, noReload) {
  const name = cfg.accounts[p.idx].name;
  const r = await js(p, `(() => {
    if (document.documentElement.classList.contains('modo-economia') === ${want}) return 'ok';
    for (const id of ${JSON.stringify(want ? ['hunt-eco', 'arena-eco'] : ['eco-sair'])}) {
      const b = document.getElementById(id);
      if (b && b.offsetParent !== null) { b.click(); return 'click'; }
    }
    if (${!!noReload}) return 'none';
    localStorage.setItem('cfg-economia', '${want ? 1 : 0}');
    return 'reload';
  })()`);
  if (!r || r === 'none') return false;
  if (r === 'reload') reloadPanel(p);
  if (p.state) p.state.eco = want;
  renderPanel(p);
  renderAllAutos();
  if (!quiet && r) toast(`${name}: ${want ? 'Modo Economia ligado (sem cena)' : 'cena ligada'}${r === 'reload' ? ' — recarregando' : ''}`);
  return !!r;
}

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
  $('.state', el).textContent = p.queued ? 'na fila…' : !s ? 'carregando…'
    : on && s.tomada ? 'aberta em outro lugar'
    : on && s.wsOpen === false ? 'reconectando…'
    : on ? '' : 'faça login';
  $('.lvl', el).textContent = on && s.level ? s.level.replace(/^\D*/, 'Nv ') : '';
  const x = xpPerHour(p);
  $('.xph b', el).textContent = x == null ? '—' : fmt(x);
  $('.sess', el).textContent = p.gained ? '+' + fmt(p.gained) : '';
  $$('.ab', el).forEach((b) => {
    const v = s && s.auto ? s.auto[b.dataset.id] : null;
    b.disabled = !on || v === null;
    b.classList.toggle('on', !!v);
  });
  $('.eco', el).classList.toggle('on', !!(s && s.eco));
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
  const ecoRow = $('#all-eco');
  if (ecoRow) {
    const n = ps.filter((p) => p.state.eco).length;
    $('.switch', ecoRow).checked = ps.length > 0 && n === ps.length;
    $('.switch', ecoRow).disabled = ps.length === 0;
    $('.count', ecoRow).textContent = ps.length ? `${n} de ${ps.length} sem cena` : 'nenhuma online';
  }
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
  // Acabou de logar: reaplica as automações escolhidas no launcher.
  if (st.loggedIn && !(prev && prev.loggedIn)) {
    setTimeout(() => AUTOS.forEach(({ id }) => id in acc.desired && setAuto(p, id, acc.desired[id])), 2500);
  }
  medirRitmo(p, st);
  if (st.precos) guardarPrecos(st.precos);
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

  const p = { idx: i, el, wv, loadedAt: Date.now(), lastXpChange: Date.now(), farming: false, ready: false, queued: delay > 0, state: null, samples: [], gained: 0, lastXp: null, muted: !!acc.muted, lastZoom: null, hotCount: 0 };
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

  wv.addEventListener('dom-ready', () => {
    p.ready = true;
    p.lastZoom = null;
    p.loadedAt = p.lastXpChange = Date.now();
    p.farming = false; // o vigia de "conta parada" só volta a valer depois que o XP subir de novo
    applyZoom(p);
    if (p.muted) wv.setAudioMuted(true);
  });
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
  $('.eco', el).onclick = () => {
    if (!(p.state && p.state.loggedIn)) return toast(`${acc.name}: entre na conta para mudar a cena`);
    setEco(p, !p.state.eco);
  };
  $('.hunts', el).onclick = () => abrirOndeCacar(p);
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

// ---------- Saúde das contas ----------
// O farm roda no SERVIDOR enquanto a conexão (WebSocket) de cada conta estiver viva. Por isso:
//  - Conexão caída: 90 s sem nenhuma mensagem do servidor → "cutucão" (o jogo confere e reconecta
//    na hora); se em 1 min não voltar → recarrega a conta. Vale mesmo com você mexendo nela.
//  - Conta parada: o XP subia e parou há 15 min (tela travada) → recarrega.
//  - Atualização preventiva: a cada N horas, para devolver a memória que a página acumula.
//    As contas não recarregam juntas: cada uma tem 3 min de diferença.
// Os dois últimos só com a conta parada nas suas mãos há 10 min. Conta aberta em outro lugar
// ("Jogar aqui" do jogo) nunca é tomada de volta sozinha.
function poke(p) { if (p.ready) try { p.wv.send('poke'); } catch {} }

function healthCheck() {
  const now = Date.now();
  for (const p of live()) {
    const s = p.state;
    if (!p.ready || !s || !s.loggedIn || s.tomada) continue;
    const name = cfg.accounts[p.idx].name;
    const dead = s.wsAgo != null && s.wsAgo > DEAD_MS;
    if (!dead) p.pokedAt = 0;
    if (cfg.watchdog !== false && dead) {
      if (!p.pokedAt) { p.pokedAt = now; poke(p); }
      else if (now - p.pokedAt > POKE_WAIT_MS) {
        p.pokedAt = 0;
        toast(`${name}: conexão caiu — recarregando a conta`);
        reloadPanel(p);
      }
      continue;
    }
    if ((s.idleMs ?? 0) < IDLE_MS) continue;
    if (cfg.watchdog !== false && p.farming && now - p.lastXpChange > STALL_MS) {
      toast(`${name}: XP parado há 15 min — recarregando a conta`);
      reloadPanel(p);
    } else if (cfg.autoRefreshH > 0 && now - p.loadedAt > cfg.autoRefreshH * 3600e3 + p.idx * 3 * 60e3) {
      toast(`${name}: atualização preventiva`);
      reloadPanel(p);
    }
  }
}

// ---------- Energia: voltar do sono, desbloquear, ausente ----------
// Voltou da suspensão/hibernação: a rede leva alguns segundos para subir. Cutuca todas as contas
// em escadinha; quem não reconectar em 1 min é recarregado pelo healthCheck.
function onPower(msg) {
  if (msg.type === 'resume' || msg.type === 'unlock') {
    live().forEach((p, i) => setTimeout(() => { p.pokedAt = 0; poke(p); }, (msg.type === 'resume' ? 8000 : 1000) + i * 2000));
    if (msg.type === 'resume') toast('PC de volta — reconectando as contas');
  } else if (msg.type === 'away') {
    setAway(msg.away);
  }
}

// "Sem cena quando ausente": com o PC ausente (5 min sem uso, tela bloqueada) ou o launcher
// minimizado, tira a cena das contas — o jogo para de desenhar, solta o mapa da memória e o servidor
// para de mandar o campo; a caça continua. Na volta, religa a cena só onde o launcher desligou.
let away = false;
async function setAway(on) {
  away = on;
  if (cfg.awayEco === false) return;
  for (const p of online()) {
    if (on && !p.state.eco) {
      if (await setEco(p, true, true, true)) p.awayEco = true;
    } else if (!on && p.awayEco) {
      p.awayEco = false;
      await setEco(p, false, true, true);
    }
  }
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
  const eco = document.createElement('label');
  eco.className = 'item';
  eco.id = 'all-eco';
  eco.innerHTML = `<i class="ic">${svgIcon('leaf')}</i><div><b>Modo Economia (sem cena)</b><small class="count"></small></div><input type="checkbox" class="switch">`;
  $('.switch', eco).onchange = (e) => {
    const ps = online();
    ps.forEach((p) => setEco(p, e.target.checked, true));
    toast(`${e.target.checked ? 'Cena desligada' : 'Cena ligada'} em ${ps.length} conta${ps.length > 1 ? 's' : ''}`);
  };
  box.appendChild(eco);

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
  // "Onde caçar" da barra: abre na conta em foco ou na primeira conta online.
  $('#btn-guide').onclick = () => {
    const f = panels.find((p) => p && p.el.classList.contains('focused')) || online()[0];
    if (f) abrirOndeCacar(f);
    else toast('Entre em uma conta para ver onde caçar');
  };
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
  $('#cfg-lock').checked = cfg.lockFarm !== false;
  $('#cfg-lock').onchange = (e) => { cfg.lockFarm = e.target.checked; save(); };
  $('#cfg-awake').checked = cfg.keepAwake === true;
  $('#cfg-awake').onchange = async (e) => { cfg.keepAwake = e.target.checked; save(); await window.launcher.keepAwake(cfg.keepAwake); };
  $('#cfg-away').checked = cfg.awayEco !== false;
  $('#cfg-away').onchange = (e) => { cfg.awayEco = e.target.checked; save(); if (!cfg.awayEco) setAway(false); };
  $('#cfg-fps').checked = cfg.fps30 !== false;
  $('#cfg-fps').onchange = (e) => { cfg.fps30 = e.target.checked; save(); toast('Vale ao atualizar as contas'); };
  $('#cfg-watch').checked = cfg.watchdog !== false;
  $('#cfg-watch').onchange = (e) => { cfg.watchdog = e.target.checked; save(); };
  $('#cfg-refresh').value = String(cfg.autoRefreshH);
  $('#cfg-refresh').onchange = (e) => { cfg.autoRefreshH = +e.target.value; save(); };
}

// ---------- Início ----------
(async function init() {
  const saved = (await window.launcher.loadCfg()) || {};
  cfg = { count: MAX, layout: 'auto', ramLimit: 2000, forceOtim: true, forceNight: true, autoRefreshH: 6, ...saved };
  delete cfg.huntScope; // extensão /hunt saiu na 1.2
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
  setInterval(healthCheck, 20000);
  window.launcher.onPower(onPower);
})();
