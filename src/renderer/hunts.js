/**
 * Melhores hunts — usa a calculadora "Onde caçar" do Guia HardToCapture, sem você sair do launcher.
 *
 * Como funciona: o launcher abre o guia escondido, cola a ficha do seu pokémon (lida quando você
 * abre o "i" dele no jogo), preenche nível do treinador, VIP e evento, lê o top 5 da tabela e fecha
 * o guia em seguida (para não ocupar memória). Os números são sempre os do guia, então quando o guia
 * ou o jogo mudam, o resultado acompanha. O cálculo roda na página do guia, no seu computador.
 */
const GUIDE_HUNTS_TTL = 30 * 60e3; // resultado guardado por 30 min (ou até mudar a ficha/nível)

// Uma consulta por vez: cada uma abre e fecha uma página do guia.
let guideQueue = Promise.resolve();
function consultGuide(input) {
  const job = guideQueue.then(() => runGuide(input));
  guideQueue = job.catch(() => {});
  return job;
}

async function runGuide(input) {
  const wv = document.createElement('webview');
  wv.setAttribute('partition', 'persist:guia');
  wv.setAttribute('src', GUIDE_URL);
  $('#guide-host').appendChild(wv);
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout')), 30000);
      wv.addEventListener('dom-ready', () => { clearTimeout(t); resolve(); }, { once: true });
      wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame) { clearTimeout(t); reject(new Error('offline')); } }, { once: true });
    });
    const out = await wv.executeJavaScript(guideScript(input));
    if (!out || !out.ok) throw new Error((out && out.error) || 'guia');
    return out;
  } finally {
    wv.remove(); // fecha o guia: a memória volta na hora
  }
}

// Roda dentro da página do guia. Usa os campos da aba "Onde caçar" (ids da própria página).
function guideScript({ ficha, trainer, vip, evento }) {
  return `(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const $ = (id) => document.getElementById(id);
    for (let i = 0; i < 80 && !($('btn-colar') && document.querySelector('#tab-hunts tbody tr')); i++) await sleep(250);
    if (!$('btn-colar') || !$('in-colar')) return { ok: false, error: 'guia-mudou' };
    const set = (id, v) => {
      const e = $(id);
      if (!e) return;
      if (e.type === 'checkbox') e.checked = !!v; else e.value = v;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const ficha = ${JSON.stringify(ficha)};
    const ta = $('in-colar');
    ta.value = ficha;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    $('btn-colar').click();
    await sleep(500);
    const nv = (ficha.match(/Nv\\s*(\\d+)/i) || [])[1];
    if (nv && $('in-nivel') && $('in-nivel').value !== nv) return { ok: false, error: 'ficha' };
    ${trainer ? `set('in-nivel-treinador', ${+trainer});` : ''}
    set('in-vip', ${!!vip});
    ${evento != null ? `set('in-evento', ${+evento});` : ''}
    await sleep(1200);

    const table = $('tab-hunts');
    const heads = [...table.querySelectorAll('thead th')].map((h) => h.textContent.trim().toUpperCase());
    const col = (re) => heads.findIndex((h) => re.test(h));
    const c = { hunt: col(/HUNT/), nv: col(/^NV/), reg: col(/REGI/), xp: col(/XP\\/H/), money: col(/DINHEIRO/), selo: col(/SELO/) };
    const cell = (r, i) => (i >= 0 && r.cells[i] ? r.cells[i].innerText.replace(/\\s+/g, ' ').trim() : '');
    const rows = [...table.querySelectorAll('tbody tr')].slice(0, 5).map((r) => {
      const xp = cell(r, c.xp);
      return {
        hunt: (r.cells[c.hunt] ? r.cells[c.hunt].innerText.split('\\n')[0] : '').trim(),
        nv: cell(r, c.nv),
        regiao: cell(r, c.reg),
        xp: (xp.match(/🐲\\s*([\\d.,]+\\s*[kMB]?)/) || [])[1] || (xp.match(/([\\d.,]+\\s*[kMB])/) || [])[1] || '',
        kills: (xp.match(/([\\d.,]+)\\s*kills\\/h/) || [])[1] || '',
        money: (cell(r, c.money).match(/^([\\d.,]+\\s*[kMB]?)/) || [])[1] || '',
        selo: cell(r, c.selo),
      };
    }).filter((r) => r.hunt);
    if (!rows.length) return { ok: false, error: 'sem-hunts' };
    const boxes = [...document.querySelectorAll('.resumo-box')].map((b) => b.textContent.replace(/\\s+/g, ' '));
    const safe = (boxes.find((t) => /Farma com segurança/i.test(t)) || '').match(/até\\s*(Nv\\s*\\d+)/i);
    return {
      ok: true,
      species: ($('in-nome') || {}).value || '',
      level: ($('in-nivel') || {}).value || '',
      safe: safe ? safe[1] : '',
      rows,
    };
  })()`;
}

// ---------- Painel no card ----------
const HUNTS_ERRORS = {
  'guia-mudou': 'O guia mudou de formato e o launcher não conseguiu ler. Use o botão abaixo para abrir o guia.',
  ficha: 'O guia não entendeu a ficha. Abra a ficha do pokémon de novo no jogo (botão "i") e tente outra vez.',
  'sem-hunts': 'O guia não encontrou hunts viáveis para esse pokémon e nível de treinador.',
  offline: 'Não foi possível abrir o guia. Confira sua internet.',
  timeout: 'O guia demorou demais para responder. Tente de novo.',
};

function trainerLevel(p) {
  if (!(p.state && p.state.loggedIn)) return null;
  return +String(p.state.level || '').replace(/\D/g, '') || null;
}

function huntsKey(p) {
  const acc = cfg.accounts[p.idx];
  const s = p.state || {};
  return [acc.ficha || '', trainerLevel(p), !!s.vip, s.evento ?? ''].join('|');
}

function fichaTitle(ficha) {
  const lines = ficha.split('\n').map((l) => l.trim()).filter(Boolean);
  const nv = (ficha.match(/Nv\s*(\d+)/i) || [])[1];
  const name = lines.find((l) => /^[A-ZÀ-ú][\w .'-]+$/.test(l) && l !== l.toUpperCase()) || lines[0] || 'Pokémon';
  return nv ? `${name} · Nv ${nv}` : name;
}

function sheetHTML(p, view) {
  const acc = cfg.accounts[p.idx];
  const s = p.state || {};
  const head = `
    <div class="sheet-head">
      <div><b>Melhores hunts</b><small>${acc.ficha ? esc(fichaTitle(acc.ficha)) : 'nenhum pokémon lido ainda'}</small></div>
      <button class="ibtn sheet-close" data-tip="Fechar"><i class="ic">${svgIcon('x')}</i></button>
    </div>`;
  const ctx = `<div class="sheet-ctx">
      <span>Treinador <b>Nv ${trainerLevel(p) ?? '—'}</b></span>
      <span>VIP <b>${s.vip ? 'sim' : 'não'}</b></span>
      <span>Evento <b>${s.evento != null ? '+' + s.evento + '%' : 'padrão do guia'}</b></span>
    </div>`;
  const foot = (extra = '') => `<div class="sheet-foot">${extra}<span>Cálculo do <a href="#" class="sheet-guide">Guia HardToCapture</a></span></div>`;

  if (view.state === 'empty') {
    return head + `<div class="sheet-empty">
      <div class="sheet-ill"><i class="ic">${svgIcon('map')}</i></div>
      <b>Abra a ficha do seu pokémon no jogo</b>
      <p>Clique no <b>"i"</b> ao lado do pokémon (a tela com Stats atuais e Stats-base). O launcher lê a ficha sozinho e calcula as melhores hunts.</p>
    </div>` + foot();
  }
  if (view.state === 'loading') {
    return head + ctx + `<div class="sheet-empty"><div class="spinner"></div><b>Consultando o guia…</b><p>Leva alguns segundos.</p></div>` + foot();
  }
  if (view.state === 'error') {
    return head + ctx + `<div class="sheet-empty"><b>Não deu desta vez</b><p>${esc(HUNTS_ERRORS[view.error] || 'Algo deu errado ao consultar o guia.')}</p>
      <div class="sheet-actions"><button class="btn-soft sheet-retry">Tentar de novo</button><button class="btn-soft sheet-guide">Abrir o guia</button></div></div>` + foot();
  }
  const r = view.result;
  const rows = r.rows.map((h, i) => `
    <div class="hunt">
      <span class="rank">${i + 1}</span>
      <div class="h-main"><b>${esc(h.hunt)}</b><small>${[h.nv && 'Nv ' + esc(h.nv), esc(h.regiao), esc(h.selo)].filter(Boolean).join(' · ')}</small></div>
      <div class="h-num"><b>${esc(h.xp) || '—'}</b><small>XP/h</small></div>
      <div class="h-num money"><b>${esc(h.money) || '—'}</b><small>$/h</small></div>
    </div>`).join('');
  const ago = Math.max(0, Math.round((Date.now() - view.at) / 60e3));
  return head + ctx +
    (r.safe ? `<div class="sheet-safe">Farma com segurança até <b>${esc(r.safe)}</b></div>` : '') +
    `<div class="hunt-list">${rows}</div>` +
    foot(`<button class="mini sheet-retry">recalcular</button><span>${ago ? `há ${ago} min` : 'agora'}</span>`);
}

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function paintSheet(p, view) {
  const sheet = $('.sheet', p.el);
  p.sheetView = view;
  sheet.innerHTML = sheetHTML(p, view);
  $('.sheet-close', sheet).onclick = () => closeSheet(p);
  $$('.sheet-retry', sheet).forEach((b) => (b.onclick = () => loadHunts(p, true)));
  $$('.sheet-guide', sheet).forEach((b) => (b.onclick = (e) => { e.preventDefault(); window.launcher.openExternal(GUIDE_URL); }));
}

async function loadHunts(p, force) {
  const acc = cfg.accounts[p.idx];
  if (!acc.ficha) return paintSheet(p, { state: 'empty' });
  const key = huntsKey(p);
  const cache = p.huntsCache;
  if (!force && cache && cache.key === key && Date.now() - cache.at < GUIDE_HUNTS_TTL) {
    return paintSheet(p, { state: 'done', result: cache.result, at: cache.at });
  }
  paintSheet(p, { state: 'loading' });
  try {
    const s = p.state || {};
    const result = await consultGuide({ ficha: acc.ficha, trainer: trainerLevel(p), vip: s.vip, evento: s.evento });
    p.huntsCache = { key, result, at: Date.now() };
    if (p.el.classList.contains('sheet-open')) paintSheet(p, { state: 'done', result, at: p.huntsCache.at });
  } catch (err) {
    if (p.el.classList.contains('sheet-open')) paintSheet(p, { state: 'error', error: err.message });
  }
}

function openSheet(p) {
  p.el.classList.add('sheet-open');
  loadHunts(p, false);
}
function closeSheet(p) {
  p.el.classList.remove('sheet-open');
}
function toggleSheet(p) {
  p.el.classList.contains('sheet-open') ? closeSheet(p) : openSheet(p);
}

// Chamado quando o jogo informa uma ficha nova.
function onFicha(p, ficha) {
  const acc = cfg.accounts[p.idx];
  if (acc.ficha === ficha) return;
  acc.ficha = ficha;
  save();
  toast(`${acc.name}: ficha do ${fichaTitle(ficha)} lida — veja as melhores hunts`);
  if (p.el.classList.contains('sheet-open')) loadHunts(p, true);
}
