/**
 * Roda dentro de cada conta (<webview>), antes dos scripts do jogo.
 *  - Aplica as preferências do launcher (Modo otimizado, Night Mode, Economia, som) e as mantém.
 *  - Mantém a conta logada entre aberturas do launcher (cópia de segurança da sessão).
 *  - Recupera sozinho quando o captcha do login falha.
 *  - Informa ao launcher XP, nick, nível, automações, VIP/evento e a ficha do pokémon aberta (só leitura).
 */
const { ipcRenderer, webFrame } = require('electron');

// ---------- Sem "pop-up" ----------
// O pop-up do jogo usa Picture-in-Picture, que dentro do launcher derrubava a janela. A versão de
// documento é desligada no main.js; aqui some a de vídeo. Sem as duas, o jogo usa o cartão na página.
webFrame.executeJavaScript(`(() => {
  try { Object.defineProperty(Document.prototype, 'pictureInPictureEnabled', { get: () => false, configurable: true }); } catch {}
  try { HTMLVideoElement.prototype.requestPictureInPicture = () => Promise.reject(new DOMException('Indisponível no launcher', 'NotSupportedError')); } catch {}
})()`);

// ---------- Preferências do jogo ----------
// O jogo lê as preferências do localStorage a cada uso (cfg-otimizado, cfg-night, cfg-economia, cfg-som = "1"/"0").
let prefs = {};
try { prefs = ipcRenderer.sendSync('game:prefs') || {}; } catch {}
ipcRenderer.on('prefs', (_e, next) => { prefs = { ...prefs, ...next }; enforcePrefs(); }); // mudanças ao vivo (ex.: som)

function enforcePrefs() {
  try {
    for (const [k, v] of Object.entries(prefs)) {
      if (k.startsWith('cfg-') && localStorage.getItem(k) !== v) localStorage.setItem(k, v);
    }
  } catch {}
  // Night Mode é uma classe no <html>; garante mesmo se algo do jogo desligar.
  const html = document.documentElement;
  if (html && prefs['cfg-night'] === '1' && !html.classList.contains('night-mode')) html.classList.add('night-mode');
}

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

// ---------- Ficha do pokémon (para "Melhores hunts") ----------
// Quando você abre a ficha de um pokémon no jogo (botão "i"), o launcher copia o texto dela —
// exatamente o que você copiaria com Ctrl+A / Ctrl+C para colar no guia. Só leitura.
const UP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LO = 'abcdefghijklmnopqrstuvwxyz';
function findText(needle) {
  const x = `//body//text()[contains(translate(., '${LO}', '${UP}'), '${needle}')]`;
  const node = document.evaluate(x, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  return node && node.parentElement;
}
let lastFicha = '';
function readFicha() {
  const head = findText('STATS ATUAIS');
  if (!head || head.offsetParent === null) return null;
  let el = head;
  while (el && el !== document.body) {
    const t = el.textContent.toUpperCase();
    if (t.includes('STATS-BASE') && /NV\s*\d/.test(t)) break;
    el = el.parentElement;
  }
  if (!el || el === document.body) return null;
  const text = el.innerText.trim();
  if (text.length > 30000 || text === lastFicha) return null;
  lastFicha = text;
  return text;
}

// Bônus que mudam a conta do guia: VIP (+50% XP) e evento do servidor ("EVENTO! +10% XP").
function readBonus() {
  const ativos = ((document.getElementById('tr-ativos') || {}).textContent || '').replace(/\s+/g, ' ');
  const vip = /VIP\s*\+\s*50\s*%/i.test(ativos);
  const ev = findText('EVENTO');
  const m = ev && ev.offsetParent !== null && ev.textContent.match(/\+\s*(\d+)\s*%\s*XP/i);
  return { vip, evento: m ? +m[1] : null };
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
    ficha: loggedIn ? readFicha() : null, // só vem quando muda
    ...(loggedIn ? readBonus() : {}),
  };
}

setInterval(() => {
  enforcePrefs();
  try { ipcRenderer.sendToHost('state', snapshot()); } catch {}
}, 2000);
