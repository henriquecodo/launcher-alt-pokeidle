/**
 * "Onde caçar?" e "Outland & renda" — o painel do troféu de cada card.
 *
 *  - Mede o RITMO real de cada conta por hunt (abates/h) com a prancheta de sessão do próprio jogo,
 *    comparando duas leituras na mesma hunt com 10 min ou mais entre elas. Junto, os drops raros.
 *  - Guarda os PREÇOS do Mercado da Comunidade quando você o abre em qualquer conta.
 *  - Pede o cálculo ao motor (src/game/hunt-engine.js), que roda dentro da conta só neste momento.
 */
const MEDIR_MIN_MS = 10 * 60e3;
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
  if ((await js(p, 'typeof window.__launcherHunt')) !== 'object') await js(p, await window.launcher.engineSource());
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
  else corpo = aba === 'hunts' ? abaHunts(p, dados.r) : abaOutland(p, dados.r);
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
