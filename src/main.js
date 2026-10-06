/**
 * Launcher Alt: PokeIdle — processo principal (Electron).
 *
 * Responsável por: criar a janela, isolar cada conta em uma sessão própria,
 * aplicar as regras de segurança dos <webview> e medir o uso de memória.
 * O launcher não tem servidor nem telemetria: as únicas páginas abertas são o jogo e,
 * quando você pede "Melhores hunts", o Guia HardToCapture (escondido e fechado em seguida).
 */
const { app, BrowserWindow, ipcMain, shell, session, webContents } = require('electron');
const path = require('path');
const fs = require('fs');

const GAME_PRELOAD = path.join(__dirname, 'preload', 'game-preload.js');
const PARTITIONS = [1, 2, 3, 4].map((n) => `persist:conta${n}`); // uma sessão isolada por conta
// Sessão separada para consultar o Guia (Melhores hunts). Não tem acesso a nenhuma conta.
const GUIDE_PARTITION = 'persist:guia';
const GUIDE_HOST = 'guiapokeidlehardtocapture.site';

// --- Economia de memória/CPU ---------------------------------------------
// Modo "low-end" do Chromium: caches e buffers menores por processo.
app.commandLine.appendSwitch('enable-low-end-device-mode');
// Limita o heap do V8 por renderer (o jogo é leve; evita crescimento sem fim).
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');
// Sem recursos que o launcher não usa (BackForwardCache guardaria páginas antigas na memória).
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,TranslateUI,MediaRouter,OptimizationHints,AutofillServerCommunication,BackForwardCache');
app.commandLine.appendSwitch('disable-smooth-scrolling');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// O farm NÃO pode pausar quando a janela fica minimizada/coberta: mantém os timers do jogo a 100%.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Uma única instância.
if (!app.requestSingleInstanceLock()) app.quit();

// --- Configuração local ----------------------------------------------------
// Fica em %APPDATA%\Launcher Alt - PokeIdle\launcher-config.json (nomes, zoom, preferências).
const cfgFile = () => path.join(app.getPath('userData'), 'launcher-config.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return null; } };

const isGameUrl = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' && (hostname === 'pokeidle.io' || hostname.endsWith('.pokeidle.io'));
  } catch { return false; }
};
const isGuideUrl = (u) => {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' && hostname === GUIDE_HOST;
  } catch { return false; }
};

ipcMain.handle('cfg:load', () => loadCfg());
ipcMain.handle('cfg:save', (_e, data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  fs.writeFileSync(cfgFile(), JSON.stringify(data, null, 2));
  return true;
});
// Só links https abrem no navegador padrão (ex.: o guia).
ipcMain.handle('open:external', (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); });

// Preferências do jogo para a conta que está carregando (lidas pelo game-preload, de forma síncrona).
ipcMain.on('game:prefs', (e) => {
  const cfg = loadCfg() || {};
  const idx = PARTITIONS.findIndex((p) => session.fromPartition(p) === e.sender.session);
  const acc = (cfg.accounts || [])[idx] || {};
  const prefs = {};
  if (cfg.forceOtim !== false) prefs['cfg-otimizado'] = '1';
  if (cfg.forceNight !== false) prefs['cfg-night'] = '1';
  if (typeof acc.eco === 'boolean') prefs['cfg-economia'] = acc.eco ? '1' : '0';
  // Conta no mudo = som do jogo desligado (o jogo nem toca/decodifica os sons).
  if (typeof acc.muted === 'boolean') prefs['cfg-som'] = acc.muted ? '0' : '1';
  prefs.keepLogin = cfg.keepLogin !== false;
  e.returnValue = prefs;
});

// RAM por conta (MB) e total do app.
ipcMain.handle('metrics:get', () => {
  const byPid = new Map(app.getAppMetrics().map((m) => [m.pid, m.memory.workingSetSize / 1024]));
  const total = [...byPid.values()].reduce((a, b) => a + b, 0);
  const accounts = PARTITIONS.map((part) => {
    const ses = session.fromPartition(part);
    const pids = new Set(
      webContents.getAllWebContents()
        .filter((w) => w.session === ses && w.getType() === 'webview' && !w.isDestroyed())
        .map((w) => w.getOSProcessId())
    );
    let mb = 0;
    pids.forEach((pid) => (mb += byPid.get(pid) || 0));
    return mb;
  });
  return { total, accounts };
});

// Limpa só o cache HTTP (não mexe em login/localStorage) para não crescer em disco/RAM.
function clearCaches() {
  [...PARTITIONS, GUIDE_PARTITION].forEach((p) => session.fromPartition(p).clearCache().catch(() => {}));
}

// Grava no disco os dados das contas (login, preferências). O Chromium faz isso sozinho de tempos em
// tempos; forçar aqui garante que nada se perca se o Windows desligar ou o launcher for fechado à força.
function flushStorage() {
  PARTITIONS.forEach((p) => {
    const ses = session.fromPartition(p);
    try { ses.flushStorageData(); } catch {}
    ses.cookies.flushStore().catch(() => {});
  });
}

// Identifica-se como Chrome comum (com "Electron/..." no user agent o captcha da Cloudflare reprova).
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// Permissões do navegador que o jogo pode usar; o resto (câmera, microfone, localização...) é negado.
const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);

// Rastreadores de anúncio/analytics que a página do jogo carrega. Não fazem parte da jogabilidade
// (o jogo já trata a ausência deles); bloquear economiza RAM, CPU e rede em cada conta.
const TRACKERS = [
  '*://*.googletagmanager.com/*',
  '*://*.google-analytics.com/*',
  '*://analytics.google.com/*',
  '*://*.doubleclick.net/*',
  '*://connect.facebook.net/*',
  '*://*.facebook.com/tr*',
];

function hardenSession(ses, blockTrackers) {
  ses.setUserAgent(CHROME_UA);
  ses.setSpellCheckerEnabled(false); // sem corretor ortográfico: não carrega dicionários na memória
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
  if (blockTrackers) ses.webRequest.onBeforeRequest({ urls: TRACKERS }, (_d, cb) => cb({ cancel: true }));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111113',
    title: 'Launcher Alt: PokeIdle',
    // Barra de título integrada à barra de ferramentas (botões do Windows desenhados por cima).
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#161618', symbolColor: '#a1a1a6', height: 52 },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload', 'ui-preload.js'),
      webviewTag: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('page-title-updated', (e) => e.preventDefault());
  // Se a própria interface cair, recarrega a janela; as contas voltam com login e automações.
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason !== 'clean-exit' && !win.isDestroyed()) setTimeout(() => win.reload(), 1000);
  });

  // Só em desenvolvimento: salva uma imagem da própria janela (LAUNCHER_SNAPSHOT=caminho.png).
  if (!app.isPackaged && process.env.LAUNCHER_SNAPSHOT) {
    setTimeout(async () => fs.writeFileSync(process.env.LAUNCHER_SNAPSHOT, (await win.webContents.capturePage()).toPNG()), +process.env.LAUNCHER_SNAPSHOT_MS || 15000);
  }
}

app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
});

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'window') {
    // A interface do launcher nunca navega nem abre janelas.
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // Todo <webview> é validado aqui: só o jogo, sempre com o nosso preload e isolado.
    contents.on('will-attach-webview', (e, webPreferences, params) => {
      const game = isGameUrl(params.src) && PARTITIONS.includes(params.partition);
      const guide = isGuideUrl(params.src) && params.partition === GUIDE_PARTITION;
      if (!game && !guide) return e.preventDefault();
      if (game) webPreferences.preload = GAME_PRELOAD;
      else delete webPreferences.preload; // o guia não recebe preload nenhum
      // Sem "pop-up" (Picture-in-Picture): dentro do launcher ele derrubava a janela. Sem a API,
      // o jogo usa o cartão dentro da própria página.
      webPreferences.disableBlinkFeatures = 'DocumentPictureInPictureAPI'; // o PiP de vídeo é desligado no game-preload
      webPreferences.sandbox = true;
      webPreferences.contextIsolation = true;
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = false;
      delete webPreferences.preloadURL;
    });
  }

  if (contents.getType() === 'webview') {
    contents.setBackgroundThrottling(false);
    // Travado: uma conta nunca sai de pokeidle.io (login social etc. é bloqueado) e o guia nunca sai do guia.
    const isGuide = contents.session === session.fromPartition(GUIDE_PARTITION);
    const lock = (e, url) => { if (!(isGuide ? isGuideUrl(url) : isGameUrl(url))) e.preventDefault(); };
    contents.on('will-navigate', lock);
    contents.on('will-redirect', lock);
    // Links externos do jogo (Discord, termos...) abrem no navegador padrão.
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  }
});

app.whenReady().then(() => {
  app.userAgentFallback = CHROME_UA;
  const blockTrackers = (loadCfg() || {}).blockTrackers !== false;
  [...PARTITIONS, GUIDE_PARTITION].forEach((p) => hardenSession(session.fromPartition(p), blockTrackers));
  createWindow();
  setInterval(clearCaches, 30 * 60 * 1000);
  setInterval(flushStorage, 60 * 1000);
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('before-quit', flushStorage);
app.on('window-all-closed', () => app.quit());
