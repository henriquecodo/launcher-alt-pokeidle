/**
 * "Onde caçar?" e "Outland & renda" — o painel do troféu de cada card.
 *
 *  - Mede o RITMO real de cada conta por hunt (abates/h) com a prancheta de sessão do próprio jogo,
 *    comparando duas leituras na mesma hunt com 10 min ou mais entre elas. Junto, os drops raros.
 *  - Lê os PREÇOS do RMT (Mercado da Comunidade) quando você o abre em qualquer conta: renda da Outland
 *    e o "Gold → Gemas" (qual item comprar com moedas para vender por Gemas).
 *  - Pede o cálculo ao motor (src/game/hunt-engine.js), que roda dentro da conta só neste momento.
 */
const MEDIR_MIN_MS = 10 * 60e3;
const MOTOR_VERSAO = 5; // a mesma de src/game/hunt-engine.js — versão nova substitui a já injetada
const RITMO_MAX = 80; // hunts lembradas por conta
// Menores anúncios vistos em 06/11/2026 — trocados sozinhos quando você abre o RMT em qualquer conta.
const PRECOS_PADRAO = { at: Date.UTC(2026, 10, 6, 12), itens: { bossToken: { gemas: 3 }, fragChave: { gemas: 192 }, fragShiny: { gemas: 93 }, fragBicicleta: { gemas: 140 } } };
const CAMPO_SESSAO = { bossToken: 'bossTokens', fragChave: 'fragChave', fragShiny: 'fragShiny', fragBicicleta: 'fragBicicleta', osso: 'ossoSacrificio' };

// ---------- medida do ritmo e dos drops ----------
function medirRitmo(p, st) {
  const s = st.sessao, slug = st.hunt;
  if (!st.loggedIn || !s || !slug) return;
  const m = p.medida;
  if (!m || m.slug !== slug || s.abates < m.abates || s.ms < m.ms) { p.medida = { slug, ...s }; return; }
  const dMs = s.ms - m.ms, dAb = s.abates - m.abates;
  if (dMs < MEDIR_MIN_MS) return;
  if (dAb >= 20) {
    const acc = cfg.accounts[p.idx];
    acc.ritmo ||= {};
    const kph = dAb / (dMs / 3.6e6);
    const ant = acc.ritmo[slug];
    acc.ritmo[slug] = { kph: Math.round(ant ? ant.kph * 0.5 + kph * 0.5 : kph), at: Date.now() };
    const slugs = Object.keys(acc.ritmo);
    if (slugs.length > RITMO_MAX) delete acc.ritmo[slugs.sort((a, b) => acc.ritmo[a].at - acc.ritmo[b].at)[0]];
    acc.drops ||= {};
    const d = (acc.drops[slug] ||= { abates: 0, ms: 0, bossToken: 0, fragChave: 0, fragShiny: 0, fragBicicleta: 0 });
    d.abates += dAb;
    d.ms += dMs;
    for (const [id, campo] of Object.entries(CAMPO_SESSAO)) d[id] = (d[id] || 0) + Math.max(0, (s[campo] | 0) - (m[campo] | 0));
    save();
  }
  p.medida = { slug, ...s };
}

// ---------- motor e RMT ----------
async function garantirMotor(p) {
  if ((await js(p, 'window.__launcherHunt ? window.__launcherHunt.versao : 0')) !== MOTOR_VERSAO) await js(p, await window.launcher.engineSource());
}

// Lê o RMT da conta (o que o jogo recebeu ao abrir a vitrine) e guarda os preços dos drops da Outland.
async function lerRmt(p) {
  await garantirMotor(p);
  const bruto = await js(p, `window.__launcherHunt.rmt().then((r) => JSON.stringify(r)).catch((e) => JSON.stringify({ erro: String((e && e.message) || e) }))`);
  let r = null;
  try { r = JSON.parse(bruto); } catch {}
  if (!r || r.erro) return r;
  p.rmtDados = r;
  const itens = { ...(cfg.precos?.itens || PRECOS_PADRAO.itens) };
  let mudou = false;
  for (const [id, d] of Object.entries(r.drops || {})) {
    const g = d.gemAgora && d.gemMedia ? Math.min(d.gemAgora, d.gemMedia) : d.gemAgora ?? d.gemMedia;
    if (g) { itens[id] = { gemas: g, unid: d.unidGemas }; mudou = true; }
  }
  if (mudou) { cfg.precos = { at: r.em, itens }; save(); }
  return r;
}

// O jogo recebeu preços novos do RMT numa conta (você abriu a vitrine): lê e avisa.
let rmtAvisoEm = 0;
async function aoRmtAberto(p) {
  const r = await lerRmt(p);
  if (!r || r.erro) return;
  if (p.el.classList.contains('sheet-open') && p.sheetAba === 'rmt') pintarSheet(p, {});
  else if (Date.now() - rmtAvisoEm > 5 * 60e3) { rmtAvisoEm = Date.now(); toast('RMT lido — clique em "Gold → Gemas" na barra para ver o que compensa'); }
}

// Botão "Gold → Gemas" da barra: abre na conta com o RMT lido mais recente (ou na conta em foco).
async function abrirRmtBarra() {
  const focada = panels.find((x) => x && x.el.classList.contains('focused'));
  const comRmt = online().filter((x) => x.mercadoEm).sort((a, b) => b.mercadoEm - a.mercadoEm);
  const p = focada && focada.mercadoEm ? focada : comRmt[0] || focada || online()[0];
  if (!p) return toast('Entre em uma conta e abra o RMT para calcular');
  p.el.classList.add('sheet-open');
  p.sheetAba = 'rmt';
  await atualizarAbaRmt(p);
}

async function atualizarAbaRmt(p) {
  if (!(p.state && p.state.loggedIn)) return pintarSheet(p, { aviso: 'Entre na conta para ler o RMT.' });
  pintarSheet(p, { carregando: 'Lendo os preços do RMT…' });
  const r = await lerRmt(p);
  if (!r) return pintarSheet(p, { aviso: 'Não foi possível ler agora. Atualize a conta (↻) e tente de novo.' });
  pintarSheet(p, {});
}

// ---------- o painel ----------
const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n, d = 0) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }));
const quando = (t) => new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const NOME_REGIAO = (r) => (r ? r.charAt(0).toUpperCase() + r.slice(1) : '');

function abrirOndeCacar(p) {
  const aberto = p.el.classList.toggle('sheet-open');
  if (aberto) { p.sheetAba ||= 'hunts'; calcularOnde(p); }
}

async function calcularOnde(p) {
  const acc = cfg.accounts[p.idx];
  if (!(p.state && p.state.loggedIn)) return pintarSheet(p, { aviso: 'Entre na conta para calcular onde caçar.' });
  pintarSheet(p, { carregando: true });
  await garantirMotor(p);
  const medido = Object.fromEntries(Object.entries(acc.ritmo || {}).map(([k, v]) => [k, v.kph]));
  const bruto = await js(p, `window.__launcherHunt.calcular(${JSON.stringify({ medido, max: 10 })})
    .then((r) => JSON.stringify(r)).catch((e) => JSON.stringify({ erro: String((e && e.message) || e) }))`);
  let r = null;
  try { r = JSON.parse(bruto); } catch {}
  if (!r) return pintarSheet(p, { aviso: 'Não foi possível calcular agora. Atualize a conta (↻) e tente de novo.' });
  if (r.erro) return pintarSheet(p, { aviso: r.erro.charAt(0).toUpperCase() + r.erro.slice(1) + '.' });
  p.sheetDados = { r, at: Date.now() };
  pintarSheet(p, {});
}

function pintarSheet(p, estado) {
  const sheet = $('.sheet', p.el);
  const dados = p.sheetDados;
  const aba = p.sheetAba || 'hunts';
  let corpo;
  if (estado.carregando) corpo = aba === 'rmt' ? `<div class="sheet-vazio"><div class="spinner"></div><b>${escH(estado.carregando)}</b></div>` : `<div class="sheet-vazio"><div class="spinner"></div><b>Calculando…</b><p>Simulando o seu pokémon em cada hunt liberada.</p></div>`;
  else if (estado.aviso) corpo = `<div class="sheet-vazio"><b>${escH(estado.aviso)}</b></div>`;
  else if (aba === 'rmt') corpo = abaRmt(p);
  else if (!dados) corpo = '';
  else corpo = aba === 'hunts' ? abaHunts(p, dados.r) : aba === 'shiny' ? abaShiny(p, dados.r) : abaOutland(p, dados.r);
  const sub = aba === 'rmt' ? `${escH(cfg.accounts[p.idx].name)}${p.rmtDados ? ` · RMT lido ${quando(p.rmtDados.em)}` : ''}`
    : dados && !estado.carregando ? `${escH(dados.r.pokemon.nome)} · Nv ${num(dados.r.pokemon.nivel)}` : cfg.accounts[p.idx].name;
  sheet.innerHTML = `
    <div class="sheet-head">
      <div><b>${aba === 'rmt' ? 'Gold → Gemas' : 'Onde caçar?'}</b><small>${sub}</small></div>
      <div class="sheet-acoes">
        <button class="ibtn sheet-recalc" data-tip="Recalcular"><i class="ic">${svgIcon('reload')}</i></button>
        <button class="ibtn sheet-close" data-tip="Fechar"><i class="ic">${svgIcon('x')}</i></button>
      </div>
    </div>
    <div class="sheet-tabs">
      <button data-aba="hunts" class="${aba === 'hunts' ? 'on' : ''}">Melhores hunts</button>
      <button data-aba="outland" class="${aba === 'outland' ? 'on' : ''}">Outland &amp; renda</button>
      <button data-aba="shiny" class="${aba === 'shiny' ? 'on' : ''}">Caça shiny</button>
      <button data-aba="rmt" class="${aba === 'rmt' ? 'on' : ''}">RMT</button>
    </div>
    <div class="sheet-corpo">${corpo}</div>`;
  $('.sheet-close', sheet).onclick = () => p.el.classList.remove('sheet-open');
  $('.sheet-recalc', sheet).onclick = () => (p.sheetAba === 'rmt' ? atualizarAbaRmt(p) : calcularOnde(p));
  $$('.sheet-tabs button', sheet).forEach((b) => (b.onclick = () => {
    p.sheetAba = b.dataset.aba;
    if (p.sheetAba === 'rmt') atualizarAbaRmt(p);
    else if (!p.sheetDados) calcularOnde(p);
    else pintarSheet(p, {});
  }));
}

function chipsContexto(r) {
  const c = [`Treinador <b>Nv ${num(r.treinador.nivel)}</b>`, `XP <b>×${num(r.bonus.multXpPokemon, 2)}</b>`];
  if (r.bonus.lootPct) c.push(`Loot <b>+${r.bonus.lootPct}%</b>`);
  if (r.bonus.tipoDoDia) c.push(`Dia sazonal <b>${escH(r.bonus.tipoDoDia)}</b>`);
  c.push(r.ritmo.medidas ? `Ritmo <b>${r.ritmo.medidas} hunt(s) medida(s)</b>` : 'Ritmo <b>ainda estimado</b>');
  return `<div class="sheet-ctx">${c.map((x) => `<span>${x}</span>`).join('')}</div>`;
}

function linhaHunt(h, i, valor, rotulo) {
  const tag = h.ritmo === 'medido' ? '<em class="tag ok">medido</em>' : '<em class="tag">estimado</em>';
  const risco = h.risco === 'arriscada' ? '<em class="tag ruim">arriscada</em>' : '';
  return `<div class="hunt">
      <span class="rank">${i + 1}</span>
      <div class="h-main"><b>${escH(h.nome)}</b><small>Nv ${num(h.nivel)} · ${escH(NOME_REGIAO(h.regiao))} · ${num(h.kph)} abates/h ${tag}${risco}</small></div>
      <div class="h-num"><b>${valor}</b><small>${rotulo}</small></div>
    </div>`;
}

function abaHunts(p, r) {
  const atual = r.atual
    ? `<div class="sheet-atual">Agora em <b>${escH(r.atual.nome)}</b>: ${fmt(r.atual.xpPokemonH)} XP/h · ${num(r.atual.kph)} abates/h <em class="tag ${r.atual.ritmo === 'medido' ? 'ok' : ''}">${r.atual.ritmo}</em></div>`
    : '';
  const lista = r.porXp.map((h, i) => linhaHunt(h, i, fmt(h.xpPokemonH), 'XP/h')).join('');
  return `${chipsContexto(r)}${atual}
    <div class="hunt-list">${lista || '<div class="sheet-vazio"><b>Nenhuma hunt segura para este pokémon.</b></div>'}</div>
    <p class="sheet-nota">XP/h do pokémon com os seus bônus, pela fórmula de combate do jogo. "Estimado" usa o ritmo típico desta conta; a hunt vira "medido" depois de 10 min caçando nela.</p>`;
}

function abaOutland(p, r) {
  const o = r.outland;
  if (!r.outlands.length) return `${chipsContexto(r)}<div class="sheet-vazio"><b>A Outland abre no nível 150 do treinador.</b></div>`;
  const acc = cfg.accounts[p.idx];
  const precos = cfg.precos || PRECOS_PADRAO;
  const base = r.atual && r.atual.area === 'outland' ? r.atual : r.outlands[0];
  const eco = r.economia || {};
  const usdt = Number(eco.orbSaqueUsdt) || 0.009;
  const taxaItem = r.taxaItemOrb ?? 0.15; // venda de item por Gemas: taxa fixa do jogo (as faixas valem só para pokémon)
  let totalLiq = 0;
  const linhas = o.drops.map((d) => {
    const porDia = (base.dropsH?.[d.id] || 0) * 24;
    const preco = Number(precos.itens?.[d.id]?.gemas) || 0;
    const liq = porDia * preco * (1 - taxaItem);
    totalLiq += liq;
    const raro = porDia > 0 && porDia < 1 ? `<small>1 a cada ${num(1 / porDia, 0)} dias</small>` : '';
    return `<tr><td>${escH(d.nome)}<small>${num(d.chance * o.tierAtual.mult * o.multLoot * 100, 4)}% por abate</small></td><td class="n">${num(porDia, porDia < 10 ? 2 : 0)}${raro}</td><td class="n">${preco ? num(preco) : '—'}</td><td class="n">${num(liq, 1)}</td></tr>`;
  }).join('');
  const saqueMin = Number(eco.saqueMinimo) || 1000;
  const dias = totalLiq > 0 ? saqueMin / totalLiq : null;
  const subir = o.melhorTier.tier > o.tierAtual.tier
    ? `<div class="sheet-dica">Você já libera a <b>${escH(o.melhorTier.rotulo)}</b> (×${num(o.melhorTier.mult, 2)}): troque no Mapa do jogo para multiplicar os drops.</div>` : '';
  const prox = (o.tiers || []).find((x) => x.tier === o.melhorTier.tier + 1);
  const proxTxt = prox ? `Próximo tier: <b>${escH(prox.rotulo)}</b> no Nv ${num(prox.nivel)} (×${num(prox.mult, 2)}).` : 'Você está no tier mais alto.';
  const med = acc.drops?.[base.slug];
  const medido = med && med.abates
    ? `<div class="sheet-medido">Medido nesta hunt: <b>${num(med.abates)}</b> abates em ${num(med.ms / 3.6e6, 1)} h · Boss Tokens <b>${med.bossToken}</b> (esperado ${num(med.abates * o.drops[0].chance * o.tierAtual.mult * o.multLoot, 1)}) · fragmentos <b>${med.fragChave + med.fragShiny + med.fragBicicleta}</b> (esperado ${num(med.abates * (o.drops[1].chance + o.drops[2].chance + o.drops[3].chance) * o.tierAtual.mult * o.multLoot, 2)})</div>`
    : '<div class="sheet-medido">Os drops reais desta hunt aparecem aqui depois de 10 min caçando nela.</div>';
  const top = r.outlands.slice(0, 5).map((h, i) => linhaHunt(h, i, num(h.kph), 'abates/h')).join('');
  return `${chipsContexto(r)}
    <div class="sheet-tier">Tier atual <b>${escH(o.tierAtual.rotulo)}</b> (×${num(o.tierAtual.mult, 2)}) · ${proxTxt}</div>
    ${subir}
    <div class="sheet-sub">Renda por dia nesta conta, caçando <b>${escH(base.nome)}</b> (${num(base.kph)} abates/h, ${base.ritmo})</div>
    <table class="renda"><thead><tr><th>Item</th><th class="n">Por dia</th><th class="n">Preço (Gemas)</th><th class="n">Gemas/dia*</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td colspan="3">Total por dia (≈ ${num(totalLiq * usdt, 2)} USDT)</td><td class="n"><b>${num(totalLiq, 1)}</b></td></tr></tfoot></table>
    <div class="sheet-nota">${dias ? `Saque mínimo (${num(saqueMin)} Gemas) em ~<b>${num(dias, 0)} dias</b> nesta conta. ` : ''}* Já sem a taxa de ${num(taxaItem * 100, 0)}% do RMT. Preços: o menor entre o anúncio atual e a média de 7 dias, lidos em ${quando(precos.at)} — abra o RMT em qualquer conta para atualizar. Estimativa pela chance publicada pelo jogo (só o multiplicador do tier, como o analisador do jogo); drop raro varia muito e não é renda garantida.</div>
    ${medido}
    <div class="sheet-sub">Outlands mais rápidas para este pokémon</div>
    <div class="hunt-list">${top}</div>`;
}

// ---------- Caça shiny ----------
// O brilho é sorteado em cada bola lançada e só fica se a bola fechar: a taxa de shiny CAPTURADO por hora
// (λ, calculada pelo motor) vira probabilidade por tempo com 1 − e^(−λ·t).
const probEm = (lambdaH, horas) => 1 - Math.exp(-lambdaH * horas);
const pct = (x) => (x == null ? '—' : x >= 0.995 ? '>99%' : x < 0.001 ? '<0,1%' : num(x * 100, x < 0.1 ? 2 : 0) + '%');
const mediaTxt = (lambdaH) => {
  if (!(lambdaH > 0)) return '—';
  const h = 1 / lambdaH;
  return h < 48 ? `~${num(h, 0)} h` : `~${num(h / 24, 0)} dias`;
};
const ESTAGIO = { 20: '1º estágio', 40: 'meio', 100: 'final' };

function abaShiny(p, r) {
  const s = r.shiny;
  if (!s || s.erro) return '<div class="sheet-vazio"><b>Atualize a conta (↻) uma vez</b><p>O launcher precisa ler de novo os dados do jogo para a caça shiny.</p></div>';
  if (!s.porTopo.length) return '<div class="sheet-vazio"><b>Nenhuma hunt fora da Outland é segura para este pokémon.</b><p>Na Outland o shiny não rola.</p></div>';
  const topo = s.bolaTopo, ouro = s.bolaOuro;
  const b = s.porTopo[0];
  const chips = [
    `Shiny <b>1 em ${num(1 / s.chance)}</b> por bola`,
    `Capture Boost <b>${s.ativos.captura > 1 ? 'ativo ×' + num(s.ativos.captura, 1) : 'desligado'}</b>`,
    `Shiny Lure <b>${s.ativos.shiny > 1 ? 'ativo ×' + num(s.ativos.shiny, 1) : 'desligado'}</b>`,
  ];
  const vip = s.vip ? '' : '<div class="sheet-dica">"Lançar sem Parar" é do VIP: sem ele, você precisa lançar a bola à mão em cada corpo.</div>';
  const colOuro = ouro ? `<th class="n">${escH(ouro.nome)}</th>` : '';
  const celOuro = (lam) => (ouro ? `<td class="n">${lam}</td>` : '');
  const tempos = [['1 dia', 24], ['7 dias', 24 * 7], ['30 dias', 24 * 30]].map(([rot, hs]) =>
    `<tr><td>${rot}</td><td class="n"><b>${pct(probEm(b.topo.agora, hs))}</b></td>${celOuro(pct(probEm(b.ouro?.agora, hs)))}</tr>`).join('');
  const cenarios = [['Sem boost', 'nenhum'], ['+ Capture Boost', 'captura'], ['+ Shiny Lure', 'lure'], ['Os dois', 'ambos']].map(([rot, k]) =>
    `<tr><td>${rot}</td><td class="n">${mediaTxt(b.topo[k])}</td>${celOuro(mediaTxt(b.ouro?.[k]))}</tr>`).join('');
  const bolasDia = b.kph * 24;
  const custo = ouro
    ? `<b>${escH(ouro.nome)}</b>: ${num(ouro.priceGold)} de ouro por bola → ~${fmt(b.custoOuroH)} de ouro/h, contra ~${fmt(b.ouroH)} de ouro/h que a hunt dá. `
    : '';
  const custoTopo = topo.priceGold ? `${escH(topo.nome)}: ${num(topo.priceGold)} de ouro por bola. ` : `${escH(topo.nome)} não se compra com ouro. `;
  const especiesTxt = b.especies.map((e) => `<tr><td>${escH(e.nome)}<small>${num(e.peso * 100, 0)}% dos selvagens · ${ESTAGIO[e.teto] || 'final'}</small></td><td class="n">${pct(e.capTopo)}</td>${celOuro(pct(e.capOuro))}</tr>`).join('');
  const lista = s.porTopo.slice(0, 5).map((h, i) => `<div class="hunt">
      <span class="rank">${i + 1}</span>
      <div class="h-main"><b>${escH(h.nome)}</b><small>Nv ${num(h.nivel)} · ${num(h.kph)} abates/h ${h.ritmo === 'medido' ? '<em class="tag ok">medido</em>' : '<em class="tag">estimado</em>'} · ${num(h.fracShiny * 100, 0)}% com shiny · ${num(h.frac1oEstagio * 100, 0)}% 1º estágio</small></div>
      <div class="h-num"><b>${mediaTxt(h.topo.agora)}</b><small>por shiny</small></div>
    </div>`).join('');
  const melhorOuro = ouro && s.porOuro[0] && s.porOuro[0].slug !== b.slug
    ? `<div class="sheet-nota">Com a ${escH(ouro.nome)}, a melhor é <b>${escH(s.porOuro[0].nome)}</b> (${mediaTxt(s.porOuro[0].ouro.agora)} por shiny).</div>` : '';
  return `<div class="sheet-ctx">${chips.map((x) => `<span>${x}</span>`).join('')}</div>${vip}
    <div class="sheet-atual">Melhor hunt: <b>${escH(b.nome)}</b> (Nv ${num(b.nivel)}, ${escH(NOME_REGIAO(b.regiao))}) · ${num(b.kph)} abates/h · ${num(b.fracShiny * 100, 0)}% dos selvagens têm shiny, ${num(b.frac1oEstagio * 100, 0)}% de 1º estágio · ~${num(b.vistosH * 24, 2)} shiny sorteado(s)/dia</div>
    <div class="sheet-sub">Chance de capturar pelo menos 1 shiny nela</div>
    <table class="renda"><thead><tr><th>Caçando por</th><th class="n">${escH(topo.nome)}</th>${colOuro}</tr></thead><tbody>${tempos}</tbody>
      <tfoot><tr><td>Em média, 1 shiny a cada</td><td class="n"><b>${mediaTxt(b.topo.agora)}</b></td>${celOuro('<b>' + mediaTxt(b.ouro?.agora) + '</b>')}</tr></tfoot></table>
    <div class="sheet-sub">Tempo médio por shiny, com boosts</div>
    <table class="renda"><thead><tr><th>Boost</th><th class="n">${escH(topo.nome)}</th>${colOuro}</tr></thead><tbody>${cenarios}</tbody></table>
    <div class="sheet-nota">São ~${fmt(bolasDia)} bolas por dia (uma por corpo). ${custoTopo}${custo}</div>
    ${melhorOuro}
    <div class="sheet-sub">Quem aparece nela (chance da bola fechar)</div>
    <table class="renda"><thead><tr><th>Espécie</th><th class="n">${escH(topo.nome)}</th>${colOuro}</tr></thead><tbody>${especiesTxt}</tbody></table>
    <div class="sheet-sub">Melhores hunts para shiny</div>
    <div class="hunt-list">${lista}</div>
    <p class="sheet-nota">Regras do Pokepédia do jogo: o shiny é sorteado em cada bola lançada (uma por corpo) e, se a bola falhar, vai embora com o corpo. Por isso conta matar rápido e ter espécies de 1º estágio, que se capturam mais fácil. Na Outland o shiny não rola. Use "Lançar sem Parar" e a melhor bola. É probabilidade: pode vir antes ou depois da média. O bônus da Kick/Twitch não entra na conta.</p>`;
}

// ---------- RMT: Gold → Gemas ----------
const gem = (x) => num(x, x != null && x < 10 ? 2 : 0);
function abaRmt(p) {
  const r = p.rmtDados;
  if (!r) return '<div class="sheet-vazio"><b>Abra o RMT nesta conta</b><p>No jogo: menu RMT → vitrine de itens, de preferência em "Todas" as categorias. O launcher lê os preços que o jogo recebe e calcula aqui.</p></div>';
  const usdt = Number(r.economia?.orbSaqueUsdt) || 0.009;
  const taxa = r.taxaItemOrb ?? 0.15;
  const chips = [`RMT lido <b>${quando(r.em)}</b>`, `Itens vistos <b>${num(r.vistos)} de ${num(r.catalogo)}</b>`, `Taxa de venda em Gemas <b>${num(taxa * 100, 0)}%</b>`, `1 Gema <b>${num(usdt, 3)} USDT</b>`];
  const ctx = `<div class="sheet-ctx">${chips.map((x) => `<span>${x}</span>`).join('')}</div>`;
  const poucos = r.catalogo && r.vistos < r.catalogo * 0.8
    ? '<div class="sheet-dica">Para comparar todos os itens, abra no RMT a categoria "Todas" (ou passe por cada categoria) e clique em ↻ aqui.</div>' : '';
  const piso = r.pedrasFora ? `<div class="sheet-medido">Pedras de evolução (Fire, Water, Leaf…, drop de qualquer pokémon) ficam fora: o mercado delas é em moedas, não em Gemas. ${num(r.pedrasFora)} fora da conta.</div>` : '';
  const ls = r.linhas || [];
  if (!ls.length) return `${ctx}${poucos}${piso}<div class="sheet-vazio"><b>Nenhum item com anúncio em moedas e preço em Gemas ao mesmo tempo.</b></div>`;
  const b = ls[0];
  const vend = (l) => (l.unidGemas ? `${num(l.unidGemas)} vendidos por Gemas em 7 dias` : 'nenhuma venda por Gemas em 7 dias');
  const melhor = `<div class="sheet-atual">Melhor agora: <b>${escH(b.nome)}</b>. Compre por <b>${fmt(b.ouro)}</b> moedas e venda por <b>${gem(b.venda)}</b> Gemas: você recebe <b>${gem(b.liquido)}</b> Gemas (já sem os ${num(taxa * 100, 0)}%). Rende <b>${num(b.gemasPorMilhao, 1)} Gemas por 1M de moedas</b> (≈ ${num(b.gemasPorMilhao * usdt, 2)} USDT) · ${vend(b)}.</div>`;
  const linhas = ls.slice(0, 15).map((l, i) => `<tr>
      <td><b>${i + 1}. ${escH(l.nome)}</b>${l.unidGemas ? '' : ' <em class="tag ruim">parado</em>'}<small>${vend(l)}</small></td>
      <td class="n">${fmt(l.ouro)}<small>${l.ouroMedia ? 'média ' + fmt(l.ouroMedia) : 'sem média'}</small></td>
      <td class="n">${gem(l.venda)}<small>agora ${l.gemAgora ? gem(l.gemAgora) : "—"} · média ${l.gemMedia ? gem(l.gemMedia) : "—"}</small></td>
      <td class="n">${gem(l.liquido)}</td>
      <td class="n"><b>${num(l.gemasPorMilhao, 1)}</b></td>
    </tr>`).join('');
  return `${ctx}${poucos}${piso}${melhor}
    <div class="sheet-sub">Comprar com moedas para vender por Gemas</div>
    <table class="renda"><thead><tr><th>Item</th><th class="n">Compra (moedas)</th><th class="n">Venda (Gemas)</th><th class="n">Recebe</th><th class="n">Gemas / 1M</th></tr></thead>
      <tbody>${linhas}</tbody></table>
    <p class="sheet-nota">Compra: o menor anúncio em moedas agora (só a 1ª unidade tem esse preço garantido; a "média" é o que se pagou nos últimos 7 dias). Venda: o menor entre o anúncio atual em Gemas e a média paga em 7 dias, menos a taxa de venda do jogo (${num(taxa * 100, 0)}% para item). Itens "parados" (sem venda por Gemas na semana) ficam no fim: anunciar não garante vender. Os preços mudam o tempo todo: confira o anúncio antes de comprar.</p>`;
}
