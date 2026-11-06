/**
 * Roda dentro de cada conta (<webview>), antes dos scripts do jogo.
 *  - Aplica as preferências do launcher (Modo otimizado e Night Mode sempre; som só ao abrir).
 *  - Limita a animação a 30 FPS (opcional) e desliga o pop-up (Picture-in-Picture).
 *  - Mantém a conta logada entre aberturas do launcher (cópia de segurança da sessão).
 *  - Recupera sozinho quando o captcha do login falha.
 *  - Mede o pulso da conexão com o servidor e aceita um "cutucão" de reconexão do launcher.
 *  - Informa ao launcher XP, nick, nível, automações, cena, conexão e se você está mexendo na conta (só leitura).
 */
const { ipcRenderer, webFrame } = require('electron');

let prefs = { force: {}, once: {} };
try { prefs = { ...prefs, ...ipcRenderer.sendSync('game:prefs') }; } catch {}

// ---------- Ajustes na página do jogo (rodam no mundo da página, antes do jogo) ----------
webFrame.executeJavaScript(`(() => {
  // Sem "pop-up": o Picture-in-Picture derrubava a janela do launcher. A versão de documento é
  // desligada no main.js; aqui some a de vídeo. Sem as duas, o jogo usa o cartão na própria página.
  try { Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', { get: () => false, configurable: true }); } catch {}
  try { HTMLVideoElement.prototype.requestPictureInPicture = () => Promise.reject(new DOMException('Indisponível no launcher', 'NotSupportedError')); } catch {}

  // Pulso da conexão: o farm roda no servidor enquanto o WebSocket do jogo estiver vivo. Aqui só
  // anotamos (no <html>, no máximo a cada 5 s) quando chegou a última mensagem do servidor e se o
  // socket está aberto — nada é enviado ou alterado na conexão.
  //
  // Coletor do "Onde caçar?": do welcome guarda só o que o cálculo usa (as hunts, a tabela de tipos,
  // os multiplicadores e as chances de drop) e, do estado do jogador, o nível, a hunt, o tier da
  // Outland, os bônus e os pokémon (stats). Fica em window[Symbol.for('launcher.jogo')], na memória
  // desta conta; o motor (src/game/hunt-engine.js) só roda quando você pede.
  (() => {
    const SYM = Symbol.for('launcher.jogo');
    const fonte = { welcome: null, eu: null, pokemons: new Map() };
    Object.defineProperty(window, SYM, { value: fonte });
    const CAMPOS_EU = ['nick', 'level', 'activeId', 'huntSlug', 'outlandTier', 'loja', 'guildBonusPct', 'diaSazonal', 'evento'];
    const pk = (p) => ({ id: p.id, speciesId: p.speciesId, nome: p.nome, level: p.level, stats: p.stats, ivs: p.ivs, tipos: p.tipos });
    const marcar = () => {
      const h = document.documentElement;
      if (!h || !fonte.eu) return;
      h.dataset.lHunt = fonte.eu.huntSlug || '';
      h.dataset.lNick = fonte.eu.nick || '';
    };
    function aplicarEstado(e) {
      if (e.cheio || !fonte.eu) { fonte.eu = {}; fonte.pokemons = new Map(); }
      for (const k of CAMPOS_EU) if (k in e) fonte.eu[k] = e[k];
      if ('guild' in e) fonte.eu.guild = e.guild ? { boostAte: e.guild.boostAte } : null;
      for (const p of e.pokemons || []) fonte.pokemons.set(p.id, pk(p));
      for (const p of e.pkMud || []) fonte.pokemons.set(p.id, pk(p));
      for (const x of e.pkFora || []) fonte.pokemons.delete(typeof x === 'object' && x ? x.id : x);
      marcar();
    }
    function aoWelcome(w) {
      fonte.welcome = {
        hunts: (w.hunts || []).map((h) => ({ slug: h.slug, nome: h.nome, area: h.area, regiao: h.regiao, nivel: h.nivel,
          especies: (h.especies || []).map((e) => ({ pokeId: e.pokeId, pontos: e.pontos })) })),
        tabelaTipos: w.tabelaTipos, ampliacaoHunt: w.ampliacaoHunt, multHpSelvagem: w.multHpSelvagem, multDanoSelvagem: w.multDanoSelvagem,
        tiposBoost: w.tiposBoost, outlandTiers: w.outlandTiers, chanceBossToken: w.chanceBossToken, economia: w.economia,
        casas: { fragmento: w.casas && w.casas.fragmento }, bicicletas: { fragmento: w.bicicletas && w.bicicletas.fragmento },
        shinyStone: { chanceDrop: w.shinyStone && w.shinyStone.chanceDrop },
      };
      if (w.estado) aplicarEstado(Object.assign({}, w.estado, { cheio: true }));
    }
    const Original = window.WebSocket;
    let atual = null;
    function Observado(...args) {
      const ws = new Original(...args);
      try {
        if (new URL(String(args[0]), location.href).host === location.host) {
          atual = ws;
          const h = () => document.documentElement;
          ws.addEventListener('open', () => { if (ws === atual && h()) { h().dataset.lws = Date.now(); h().dataset.lwsOpen = '1'; } });
          ws.addEventListener('message', (ev) => {
            const el = h(); const n = Date.now();
            if (ws === atual && el && n - (+el.dataset.lws || 0) > 5000) el.dataset.lws = n;
            if (ws !== atual || typeof ev.data !== 'string') return;
            const cab = ev.data.slice(0, 40);
            try {
              if (cab.indexOf('"t":"welcome"') >= 0) aoWelcome(JSON.parse(ev.data));
              else if (cab.indexOf('"t":"estado"') >= 0) { const m = JSON.parse(ev.data); if (m.estado) aplicarEstado(m.estado); }
            } catch (err) {}
          });
          ws.addEventListener('close', () => { if (ws === atual && h()) h().dataset.lwsOpen = '0'; });
        }
      } catch {}
      return ws;
    }
    Observado.prototype = Original.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) Observado[k] = Original[k];
    window.WebSocket = Observado;
  })();

  // Animação a 30 FPS: o jogo move tudo pelo tempo entre quadros, então desenhar metade dos
  // quadros não muda a caça — só corta pela metade o custo de desenhar a cena.
  if (${!!prefs.fps30}) {
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const SLOT = 1000 / 30;
    let servedT = -1, servedSlot = -1, seq = 0;
    const live = new Map(); // id nosso -> id real do navegador
    window.requestAnimationFrame = (cb) => {
      const id = ++seq;
      const tick = (t) => {
        const slot = Math.floor(t / SLOT);
        if (t === servedT || slot !== servedSlot) { // todos os pedidos do mesmo quadro saem juntos
          servedT = t; servedSlot = slot; live.delete(id); cb(t);
        } else {
          live.set(id, raf(tick));
        }
      };
      live.set(id, raf(tick));
      return id;
    };
    window.cancelAnimationFrame = (id) => { const real = live.get(id); if (real !== undefined) caf(real); live.delete(id); };
  }
})()`);

// ---------- Preferências do jogo ----------
// O jogo lê as preferências do localStorage a cada uso ("1"/"0").
function applyOnce(map) {
  try { for (const [k, v] of Object.entries(map || {})) localStorage.setItem(k, v); } catch {}
}
function enforcePrefs() {
  try {
    for (const [k, v] of Object.entries(prefs.force)) if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
  } catch {}
  // Night Mode é uma classe no <html>; garante mesmo se algo do jogo desligar.
  const html = document.documentElement;
  if (html && prefs.force['cfg-night'] === '1' && !html.classList.contains('night-mode')) html.classList.add('night-mode');
}
// Mudanças pedidas pelo launcher com a conta aberta (ex.: som): aplicadas uma vez, sem insistir.
ipcRenderer.on('prefs', (_e, once) => applyOnce(once));
// "Cutucão": o jogo reconecta na hora quando a rede volta ou a janela ganha foco (ver verificarConexao
// no jogo). Disparar os mesmos eventos faz ele conferir a conexão agora, sem esperar o próximo tique.
ipcRenderer.on('poke', () => { try { dispatchEvent(new Event('online')); dispatchEvent(new Event('focus')); } catch {} });

// ---------- Manter a conta logada ----------
// O jogo guarda o login em localStorage["sessao"] e, ao abrir, confere o token no servidor. Se essa
// conferência falhar por um problema passageiro (rede ainda subindo, Cloudflare), o jogo apaga a sessão
// e pede login de novo. O launcher guarda uma cópia da última sessão válida e a devolve nesses casos.
// A cópia fica só no armazenamento desta conta, no seu computador — igual ao que o jogo já guarda.
const SESSION = 'sessao';
const BACKUP = '__launcher_sessao';
const RETRY = '__launcher_retry'; // sessionStorage: tentativas de recuperação nesta abertura
const keepLogin = prefs.keepLogin !== false;
let sawLoggedIn = false;

function restoreSession() {
  try {
    if (!keepLogin) { localStorage.removeItem(BACKUP); return false; }
    const backup = localStorage.getItem(BACKUP);
    if (backup && !localStorage.getItem(SESSION)) { localStorage.setItem(SESSION, backup); return true; }
  } catch {}
  return false;
}
restoreSession();
applyOnce(prefs.once);

// ---------- Aviso de cookies ----------
// O jogo só carrega Google Tag Manager e Meta Pixel se você tocar em "Aceitar" (opt-in). Com
// "Bloquear rastreadores" ligado eles não carregariam de qualquer jeito, então o launcher responde
// "Recusar" — só se você ainda não escolheu nada nesta conta — e a faixa não cobre o rodapé do jogo.
if (prefs.declineCookies) {
  try {
    if (!localStorage.getItem('cookies-consentimento')) {
      localStorage.setItem('cookies-consentimento', JSON.stringify({ escolha: 'recusado', em: Date.now(), v: 1 }));
    }
  } catch {}
}
enforcePrefs();
document.addEventListener('DOMContentLoaded', enforcePrefs);

// Ao "Sair" o jogo apaga a sessão e recarrega na hora. Se a página estava logada e fecha sem sessão,
// foi você quem saiu (ou excluiu a conta): a cópia é descartada para o launcher não relogar sozinho.
window.addEventListener('pagehide', () => {
  try { if (sawLoggedIn && !localStorage.getItem(SESSION)) localStorage.removeItem(BACKUP); } catch {}
});

function retries() {
  try { return JSON.parse(sessionStorage.getItem(RETRY) || '[]').filter((t) => Date.now() - t < 5 * 60e3); } catch { return []; }
}
// Recarrega a conta no máximo 3 vezes a cada 5 min (evita ficar em loop se o problema for outro).
let recovering = false;
function recover() {
  const list = retries();
  if (recovering || list.length >= 3) return;
  recovering = true;
  try { sessionStorage.setItem(RETRY, JSON.stringify([...list, Date.now()])); } catch {}
  setTimeout(() => location.reload(), 2000 + list.length * 4000);
}

function watchSession(loggedIn, loginVisible) {
  if (!keepLogin) return;
  try {
    const cur = localStorage.getItem(SESSION);
    if (loggedIn) {
      sawLoggedIn = true;
      if (cur && cur !== localStorage.getItem(BACKUP)) localStorage.setItem(BACKUP, cur); // acompanha a renovação do token
      try { sessionStorage.removeItem(RETRY); } catch {}
    } else if (sawLoggedIn && !cur) {
      // Estava logada e a sessão sumiu com a página aberta = você saiu da conta. Respeita isso.
      localStorage.removeItem(BACKUP);
      sawLoggedIn = false;
    } else if (!sawLoggedIn && loginVisible && !cur && localStorage.getItem(BACKUP)) {
      // Abriu pedindo login mas existe sessão guardada: o jogo descartou por falha passageira.
      if (restoreSession()) recover();
    }
  } catch {}
}

// ---------- Captcha que falhou ----------
// "Não deu para confirmar que você não é um robô" costuma se resolver recarregando a página.
function captchaFailed(login) {
  if (!login) return false;
  return [...login.querySelectorAll('*')].some(
    (e) => e.children.length === 0 && e.offsetParent !== null && /rob[ôo]/i.test(e.textContent) && /tente|n[ãa]o deu/i.test(e.textContent)
  );
}

// ---------- Você está mexendo nesta conta? ----------
// O launcher nunca recarrega sozinho (atualização preventiva, conta parada) enquanto você usa a conta.
let lastInput = Date.now();
for (const ev of ['pointerdown', 'keydown', 'wheel']) addEventListener(ev, () => (lastInput = Date.now()), { capture: true, passive: true });

// ---------- Medidas para o "Onde caçar?" e a renda da Outland ----------
// A "prancheta" da sessão que o próprio jogo guarda (localStorage "sessao-hunt:<nick>"): abates,
// tempo e drops. O launcher compara duas leituras na MESMA hunt para medir o ritmo real.
function lerSessao() {
  const nick = (document.documentElement.dataset.lNick || '').toLowerCase();
  if (!nick) return null;
  try {
    const s = JSON.parse(localStorage.getItem('sessao-hunt:' + nick) || 'null');
    if (!s) return null;
    return { abates: s.abates | 0, ms: s.ms | 0, xpTreinador: s.xpTreinador || 0, gold: s.gold || 0,
      bossTokens: s.bossTokens | 0, fragChave: s.fragChave | 0, fragShiny: s.fragShiny | 0, fragBicicleta: s.fragBicicleta | 0 };
  } catch { return null; }
}

// Preços do Mercado da Comunidade: lidos SÓ quando você o abre (aba Fragmentos ou Boss Tokens).
// Pega o menor anúncio ("A partir de") em gold e em Gemas de cada item que a Outland solta.
const ITENS_MERCADO = {
  'Bronze Boss Token': 'bossToken',
  'Fragmento de Chave': 'fragChave', 'Key Fragment': 'fragChave', 'Fragmento de Llave': 'fragChave',
  'Fragmento de Shiny Stone': 'fragShiny', 'Shiny Stone Fragment': 'fragShiny',
  'Fragmento de Bicicleta': 'fragBicicleta', 'Bicycle Fragment': 'fragBicicleta', 'Fragmento de bicicleta': 'fragBicicleta',
};
const porTexto = (t) => document.evaluate(`//body//*[normalize-space(text())=${JSON.stringify(t)}]`, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
let tickPrecos = 0;
function lerPrecos() {
  const titulo = porTexto('MERCADO DA COMUNIDADE') || porTexto('Mercado da Comunidade') || porTexto('COMMUNITY MARKET');
  if (!titulo || titulo.offsetParent === null) return null;
  const precos = {};
  for (const [nome, id] of Object.entries(ITENS_MERCADO)) {
    if (precos[id]) continue;
    const el = porTexto(nome);
    if (!el || el.offsetParent === null) continue;
    let linha = el;
    for (let i = 0; i < 6 && linha && !/partir|from|desde/i.test(linha.innerText); i++) linha = linha.parentElement;
    if (!linha) continue;
    const depois = linha.innerText.split(/A partir de:?|From:?|Desde:?/i).slice(1).map((s) => (s.match(/[\d.,]+/) || [''])[0].replace(/[.,]/g, ''));
    const nums = depois.filter(Boolean).map(Number);
    if (nums.length >= 2) precos[id] = { gold: nums[0], gemas: nums[nums.length - 1] };
    else if (nums.length === 1) precos[id] = { gemas: nums[0] };
  }
  return Object.keys(precos).length ? precos : null;
}

// ---------- Estado para o launcher ----------
const AUTO_IDS = ['auto-ball-captura', 'auto-ball-sem-parar', 'auto-revive', 'auto-potion', 'auto-voltar-hunt'];

function snapshot() {
  const $ = (id) => document.getElementById(id);
  const txt = (id) => (($(id) || {}).textContent || '').trim();
  const login = $('login');
  const loginVisible = !!(login && login.offsetParent !== null);
  const auto = {};
  for (const id of AUTO_IDS) {
    const el = $(id);
    auto[id] = el ? !!el.checked : null;
  }
  const loggedIn = !loginVisible && !!txt('tr-xp-txt');
  watchSession(loggedIn, loginVisible);
  if (loginVisible && captchaFailed(login)) recover();
  return {
    loggedIn,
    xpText: txt('tr-xp-txt'),
    nick: txt('tr-nick'),
    level: txt('tr-level'),
    gold: txt('tr-gold'),
    auto,
    eco: document.documentElement.classList.contains('modo-economia'), // Modo Economia (sem cena)
    idleMs: Date.now() - lastInput,
    wsAgo: (() => { const l = +document.documentElement.dataset.lws; return l ? Date.now() - l : null; })(), // ms desde a última mensagem do servidor
    wsOpen: document.documentElement.dataset.lwsOpen === '1',
    tomada: !!(document.getElementById('sessao-tomada') && document.getElementById('sessao-tomada').offsetParent !== null), // conta aberta em outro lugar
    hunt: document.documentElement.dataset.lHunt || null,
    sessao: loggedIn ? lerSessao() : null,
    precos: loggedIn && ++tickPrecos % 5 === 0 ? lerPrecos() : null, // a cada 10 s, e só com o Mercado aberto
  };
}

setInterval(() => {
  enforcePrefs();
  try { ipcRenderer.sendToHost('state', snapshot()); } catch {}
}, 2000);
