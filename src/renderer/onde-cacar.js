/**
 * "Onde caçar?" e "Outland & renda" — o painel do troféu de cada card.
 *
 *  - Mede o RITMO real de cada conta por hunt (abates/h) com a prancheta de sessão do próprio jogo,
 *    comparando duas leituras na mesma hunt com 10 min ou mais entre elas. Junto, os drops raros.
 *  - Guarda os PREÇOS do Mercado da Comunidade quando você o abre em qualquer conta.
 *  - Pede o cálculo ao motor (src/game/hunt-engine.js), que roda dentro da conta só neste momento.
 */
const MEDIR_MIN_MS = 10 * 60e3;
const MOTOR_VERSAO = 2; // a mesma de src/game/hunt-engine.js — versão nova substitui a já injetada
const RITMO_MAX = 80; // hunts lembradas por conta
// Menores anúncios vistos em 06/11/2026 — trocados sozinhos quando você abre o Mercado da Comunidade.
const PRECOS_PADRAO = { at: Date.UTC(2026, 10, 6, 12), itens: { bossToken: { gemas: 3 }, fragChave: { gemas: 192 }, fragShiny: { gemas: 93 }, fragBicicleta: { gemas: 140 } } };
const CAMPO_SESSAO = { bossToken: 'bossTokens', fragChave: 'fragChave', fragShiny: 'fragShiny', fragBicicleta: 'fragBicicleta' };

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
    for (const [id, campo] of Object.entries(CAMPO_SESSAO)) d[id] += Math.max(0, (s[campo] | 0) - (m[campo] | 0));
    save();
  }
  p.medida = { slug, ...s };
}

let precosAvisoEm = 0;
function guardarPrecos(precos) {
  cfg.precos = { at: Date.now(), itens: { ...(cfg.precos?.itens || PRECOS_PADRAO.itens), ...precos } };
  save();
  if (Date.now() - precosAvisoEm > 60e3) { precosAvisoEm = Date.now(); toast('Preços do Mercado da Comunidade atualizados para a renda da Outland'); }
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
  if ((await js(p, 'window.__launcherHunt ? window.__launcherHunt.versao : 0')) !== MOTOR_VERSAO) await js(p, await window.launcher.engineSource());
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
  if (estado.carregando) corpo = `<div class="sheet-vazio"><div class="spinner"></div><b>Calculando…</b><p>Simulando o seu pokémon em cada hunt liberada.</p></div>`;
  else if (estado.aviso) corpo = `<div class="sheet-vazio"><b>${escH(estado.aviso)}</b></div>`;
  else if (!dados) corpo = '';
  else corpo = aba === 'hunts' ? abaHunts(p, dados.r) : aba === 'shiny' ? abaShiny(p, dados.r) : abaOutland(p, dados.r);
  const sub = dados && !estado.carregando ? `${escH(dados.r.pokemon.nome)} · Nv ${num(dados.r.pokemon.nivel)}` : cfg.accounts[p.idx].name;
  sheet.innerHTML = `
    <div class="sheet-head">
      <div><b>Onde caçar?</b><small>${sub}</small></div>
      <div class="sheet-acoes">
        <button class="ibtn sheet-recalc" data-tip="Recalcular"><i class="ic">${svgIcon('reload')}</i></button>
        <button class="ibtn sheet-close" data-tip="Fechar"><i class="ic">${svgIcon('x')}</i></button>
      </div>
    </div>
    <div class="sheet-tabs">
      <button data-aba="hunts" class="${aba === 'hunts' ? 'on' : ''}">Melhores hunts</button>
      <button data-aba="outland" class="${aba === 'outland' ? 'on' : ''}">Outland &amp; renda</button>
      <button data-aba="shiny" class="${aba === 'shiny' ? 'on' : ''}">Caça shiny</button>
    </div>
    <div class="sheet-corpo">${corpo}</div>`;
  $('.sheet-close', sheet).onclick = () => p.el.classList.remove('sheet-open');
  $('.sheet-recalc', sheet).onclick = () => calcularOnde(p);
  $$('.sheet-tabs button', sheet).forEach((b) => (b.onclick = () => { p.sheetAba = b.dataset.aba; pintarSheet(p, {}); }));
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
  const taxa = (g) => { const f = (eco.faixasMercadoOrb || []).find((x) => x.ate == null || g <= x.ate); return (f ? f.pct : 13) / 100; };
  let totalLiq = 0;
  const linhas = o.drops.map((d) => {
    const porDia = (base.dropsH?.[d.id] || 0) * 24;
    const preco = Number(precos.itens?.[d.id]?.gemas) || 0;
    const liq = porDia * preco * (1 - taxa(preco));
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
    <div class="sheet-nota">${dias ? `Saque mínimo (${num(saqueMin)} Gemas) em ~<b>${num(dias, 0)} dias</b> nesta conta. ` : ''}* Já sem a taxa do Mercado. Preços: menor anúncio em ${quando(precos.at)} — abra o Mercado da Comunidade (Fragmentos ou Boss Tokens) em qualquer conta para atualizar. Estimativa pela chance publicada pelo jogo; drop raro varia muito e não é renda garantida.</div>
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
