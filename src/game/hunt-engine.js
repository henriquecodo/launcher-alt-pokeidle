/**
 * Motor do "Onde caçar?" do Launcher Alt — roda DENTRO da página do jogo (mundo da página), só quando
 * você pede um cálculo. Escrito para o launcher a partir das regras que o próprio jogo publica na
 * Poképédia (capítulos Combate, Stats e Tipos) e dos módulos do jogo, importados do pokeidle.io:
 *
 *   dano      = ((2 × nível/5 + 2) × poder × atk/def) / 50 + 2   × STAB(1,5) × efetividade × aleatório(0,85–1)
 *   efetividade na hunt: ×v>1 → 1 + (v−1) × ampliação; ×v<1 → v ÷ ampliação; ×0 e ×1 não mudam
 *   escolha   = o golpe recarregado de maior dano esperado; sem nenhum, a Investida (poder 30, 2 s)
 *   cadência  = intervalo mínimo entre golpes 0,9 s e Investida 2 s, −10 ms por ponto de IV de SPD (piso 0,4 s);
 *               recarga dos golpes com o desconto do Speed (cooldown-golpes.mjs do jogo)
 *   selvagem  = stats da fórmula da ficha com IV médio 16, HP de combate máx(24, hp × 12) × multHpSelvagem
 *   recompensa= XP e ouro por abate do jogo (recompensa-hunt.mjs) × bônus de XP do jogo (hunt-analyser.mjs)
 *
 * O único número que o jogo não publica é o tempo "morto" entre um abate e outro (andar até o bando,
 * esperar a onda). Ele vem do RITMO MEDIDO nas suas contas (o launcher anota abates/h reais por hunt)
 * e, sem medida, de um padrão. Por isso cada linha diz se o ritmo é "medido" ou "estimado".
 */
(() => {
  if ((window.__launcherHunt?.versao ?? 0) >= 2) return;
  const SYM = Symbol.for('launcher.jogo'); // o coletor do launcher (game-preload) guarda aqui o welcome + estado

  const REGRA = {
    aleatorioMedio: 0.925, stab: 1.5, gapMs: 900, investidaPoder: 30, investidaCdMs: 2000,
    pisoMs: 400, msPorIvSpd: 10, hpMult: 12, hpMin: 24, ivSelvagem: 16, gapSelvagemMs: 1400,
  };
  const ABATES_SIMULADOS = 30;
  const STATS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];
  const BASE = { hp: 'baseHp', atk: 'baseAtk', def: 'baseDef', spAtk: 'baseSpAtk', spDef: 'baseSpDef', speed: 'baseSpeed' };

  // ---------- módulos e catálogo do jogo (sob demanda, solto da memória depois) ----------
  const imp = (p) => import(`${location.origin}/${p}`);
  let modulos = null;
  async function carregarModulos() {
    if (modulos) return modulos;
    const [outland, planilhas, baseOutland, evol, ajustes, especiais, orre, megas, cooldown, nota, mistico, recompensa, tipos, analyser, sazonal, degrau, teto, formas] =
      await Promise.all([
        'shared/outland.mjs', 'shared/golpes-planilhas.mjs', 'shared/herdar-base-outland.mjs', 'shared/evolucoes-cruzadas.mjs',
        'shared/ajustes-especie-espelho.mjs', 'shared/golpes-especiais.mjs', 'shared/herdar-golpes-orre.mjs', 'shared/megas.mjs',
        'shared/cooldown-golpes.mjs', 'shared/nota-pokemon.mjs', 'shared/mistico.mjs', 'shared/recompensa-hunt.mjs',
        'shared/tipo-efetividade.mjs', 'hunt-analyser.mjs', 'shared/dia-sazonal.mjs',
        'shared/captura-degrau.mjs', 'shared/teto-captura.mjs', 'shared/formas.mjs',
      ].map(imp));
    modulos = { outland, planilhas, baseOutland, evol, ajustes, especiais, orre, megas, cooldown, nota, mistico, recompensa, tipos, analyser, sazonal, degrau, teto, formas };
    return modulos;
  }

  let catalogo = null;
  let soltarCatalogo = null;
  const lerJson = (p, opcional) => fetch(`${location.origin}/${p}`, { cache: 'force-cache' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => (opcional ? null : Promise.reject(new Error(`sem ${p}`))));

  // Os passos que mexem em combate (stats-base, tipos, golpes), na ordem em que o cliente do jogo monta.
  async function carregarCatalogo(m) {
    if (catalogo) return catalogo;
    const [cr, novos, outlandNovos, formas, overrides] = await Promise.all([
      lerJson('assets/creatures.json'), lerJson('assets/creatures-novos.json', true), lerJson('assets/creatures-outland-novos.json', true),
      lerJson('assets/creatures-formas.json', true), lerJson('assets/creatures-audit-overrides.json', true),
    ]);
    const lista = [...(cr?.creatures ?? [])];
    for (const extra of [novos, outlandNovos, formas]) if (extra?.creatures?.length) lista.push(...extra.creatures);
    m.outland.aplicarRemapOutlandLista(lista);
    for (const o of overrides?.overrides ?? []) {
      const c = lista.find((x) => x.pokeId === o.pokeId);
      if (!c) continue;
      for (const k of Object.values(BASE)) if (typeof o[k] === 'number') c[k] = o[k];
      if (Array.isArray(o.attacks)) c.attacks = o.attacks.map((a) => ({ ...a }));
    }
    m.planilhas.aplicarGolpesDasPlanilhas((id) => lista.filter((c) => c.pokeId === id));
    m.baseOutland.herdarBaseOutland(lista);
    m.evol.aplicarCadeiasTruncadas(lista);
    m.evol.normalizarEvolveLevel600(lista);
    m.ajustes.aplicarAjustesHuntLevel?.((id) => lista.find((c) => c.pokeId === id));
    const especies = new Map();
    for (const c of lista) {
      if (m.outland.isEspelhoFantasmaPokeId(c.pokeId)) continue;
      m.especiais.injetarGolpesEspeciais(c);
      especies.set(c.pokeId, c);
    }
    m.orre.herdarGolpesOrre(lista);
    for (const mega of m.megas.criarEspeciesMega(lista) ?? []) especies.set(mega.pokeId, mega);
    // Estágio evolutivo de cada espécie (o "Nível ao capturar" 20 · 40 · 100), que decide a chance de captura.
    especies.estagios = m.teto.montarEstagiosEvolutivos(lista, (id) => especies.get(id));
    catalogo = especies;
    // ~20 MB de catálogo: solto 3 min depois do último cálculo, para não pesar na conta.
    clearTimeout(soltarCatalogo);
    soltarCatalogo = setTimeout(() => { catalogo = null; }, 3 * 60e3);
    return catalogo;
  }

  // ---------- regras de combate ----------
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const ivSpd = (iv) => limitar(Math.round(Number(iv) || 1), 1, 32);
  const tiposDe = (esp) => [esp.type1, esp.type2].filter(Boolean);

  function efetividade(m, ctx, tipoGolpe, alvoTipos) {
    const v = m.tipos.efetividade(tipoGolpe, alvoTipos[0], alvoTipos[1] ?? null, ctx.tabelaTipos);
    const amp = ctx.ampliacaoHunt ?? 1.5;
    return v === 0 || v === 1 ? v : v > 1 ? 1 + (v - 1) * amp : v / amp;
  }

  const danoBase = (nivel, poder, atk, def) => ((2 * nivel / 5 + 2) * poder * atk / Math.max(1, def)) / 50 + 2;

  function statsSelvagem(m, esp, nivel) {
    const lend = !!m.mistico.ehLendarioOuMitico?.(esp.pokeId);
    const mult = m.nota.multDeNascenca(1, false, lend);
    const s = {};
    for (const k of STATS) s[k] = Math.round(((esp[BASE[k]] ?? 0) + 2 * REGRA.ivSelvagem) * nivel / 100 * mult);
    return s;
  }

  function sazonalMult(m, ctx, tiposAtk, tiposDef) {
    return ctx.tipoDoDia ? m.sazonal.multDanoSazonal(ctx.tipoDoDia, tiposAtk, tiposDef) : 1;
  }

  /** Golpes do seu pokémon, com recarga já descontada pelo Speed (como o jogo faz). */
  function golpesDoPokemon(m, pk, esp) {
    const golpes = (esp.attacks ?? [])
      .filter((a) => (Number(a.power) || 0) > 0 && (!a.learnLevel || a.learnLevel <= pk.level))
      .map((a) => ({
        nome: a.name, tipo: a.type, poder: Number(a.power), fisico: a.category !== 'SPECIAL',
        cdMs: m.cooldown.cooldownGolpeComSpeed(a.cooldownMs ?? m.cooldown.cooldownDoPoder(a.power), esp.baseSpeed, pk.ivs?.speed),
      }));
    return golpes;
  }

  /**
   * Simula o seu pokémon contra uma espécie: abates seguidos, recargas valendo de um abate para o
   * outro (no jogo elas não reiniciam) e o tempo morto do mapa entre eles, recarregando.
   */
  function simularContra(m, ctx, pk, golpes, alvo, nivel, mortoS) {
    const st = statsSelvagem(m, alvo, nivel);
    const hpAlvo = Math.max(REGRA.hpMin, Math.round(st.hp * REGRA.hpMult)) * (ctx.multHpSelvagem ?? 1);
    const tiposAlvo = tiposDe(alvo);
    const gap = Math.max(REGRA.pisoMs, REGRA.gapMs - ivSpd(pk.ivs?.speed) * REGRA.msPorIvSpd);
    const invCd = Math.max(REGRA.pisoMs, REGRA.investidaCdMs - ivSpd(pk.ivs?.speed) * REGRA.msPorIvSpd);
    // dano esperado de cada golpe contra este alvo
    const opcoes = golpes.map((g) => {
      const atk = g.fisico ? pk.stats.atk : pk.stats.spAtk;
      const def = g.fisico ? st.def : st.spDef;
      const ef = efetividade(m, ctx, g.tipo, tiposAlvo);
      const dano = danoBase(pk.level, g.poder, atk, def) * (pk.tipos.includes(g.tipo) ? REGRA.stab : 1) * ef
        * REGRA.aleatorioMedio * sazonalMult(m, ctx, pk.tipos, tiposAlvo);
      return { ...g, dano: ef === 0 ? 0 : dano, pronto: 0 };
    }).filter((g) => g.dano > 0).sort((a, b) => b.dano - a.dano);
    // Investida: no 1º tipo; só no 2º se o alvo for imune ao 1º
    const tipoInv = efetividade(m, ctx, pk.tipos[0], tiposAlvo) === 0 && pk.tipos[1] ? pk.tipos[1] : pk.tipos[0];
    const efInv = efetividade(m, ctx, tipoInv, tiposAlvo);
    const danoInv = efInv === 0 ? 0 : danoBase(pk.level, REGRA.investidaPoder, pk.stats.atk, st.def) * REGRA.stab * efInv
      * REGRA.aleatorioMedio * sazonalMult(m, ctx, pk.tipos, tiposAlvo);
    if (!opcoes.length && danoInv <= 0) return null; // não consegue ferir

    let t = 0, invPronta = 0, proximo = 0, luta = 0;
    const usos = new Map();
    for (let k = 0; k < ABATES_SIMULADOS; k++) {
      t += mortoS * 1000; // anda até o próximo / espera a onda — as recargas correm
      let hp = hpAlvo;
      const inicio = t;
      for (let n = 0; hp > 0 && n < 5000; n++) {
        t = Math.max(t, proximo);
        const g = opcoes.find((o) => o.pronto <= t);
        if (g) { hp -= g.dano; g.pronto = t + g.cdMs; usos.set(g.nome, (usos.get(g.nome) || 0) + 1); }
        else if (danoInv > 0 && invPronta <= t) { hp -= danoInv; invPronta = t + invCd; usos.set('Investida', (usos.get('Investida') || 0) + 1); }
        else { t = Math.min(...opcoes.map((o) => o.pronto), danoInv > 0 ? invPronta : Infinity); continue; }
        proximo = t + gap;
      }
      luta += t - inicio;
    }
    const lutaS = luta / ABATES_SIMULADOS / 1000;
    const melhor = [...usos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // O que o selvagem tira de você por abate (para a segurança da hunt)
    const meuHp = Math.max(REGRA.hpMin, Math.round(pk.stats.hp * REGRA.hpMult));
    let dpsSelv = 0;
    for (const a of alvo.attacks ?? []) {
      const poder = Number(a.power) || 0;
      if (poder <= 0) continue;
      const fis = a.category !== 'SPECIAL';
      const ef = efetividade(m, ctx, a.type, pk.tipos);
      const d = danoBase(nivel, poder, fis ? st.atk : st.spAtk, fis ? pk.stats.def : pk.stats.spDef) * (tiposAlvo.includes(a.type) ? REGRA.stab : 1)
        * ef * REGRA.aleatorioMedio * (ctx.multDanoSelvagem ?? 1) * sazonalMult(m, ctx, tiposAlvo, pk.tipos);
      dpsSelv = Math.max(dpsSelv, d / (Math.max(REGRA.gapSelvagemMs, a.cooldownMs ?? m.cooldown.cooldownDoPoder(poder)) / 1000));
    }
    const danoPorAbate = dpsSelv * lutaS;
    return { lutaS, melhor, danoPorAbate, meuHp, efMelhor: opcoes[0] ? efetividade(m, ctx, opcoes[0].tipo, tiposAlvo) : efInv };
  }

  // ---------- o cálculo ----------
  const mediana = (v) => { const s = [...v].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

  /**
   * opcoes: { pokemonId?, medido: { [slug]: abates/h reais desta conta }, soLiberadas, comPocao, max }
   * O tempo morto por abate (andar, esperar a onda, jogar bola) sai do que foi MEDIDO: abates/h reais
   * menos a luta simulada. Hunt sem medida usa a mediana das medidas desta conta (ou 3,3 s).
   */
  async function calcular(opcoes = {}) {
    const fonte = window[SYM];
    if (!fonte?.welcome || !fonte?.eu) throw new Error('o jogo ainda não mandou os dados desta conta — espere conectar');
    const m = await carregarModulos();
    const especies = await carregarCatalogo(m);
    const w = fonte.welcome;
    const eu = fonte.eu;
    const agora = Date.now();
    const pkEstado = fonte.pokemons.get(opcoes.pokemonId ?? eu.activeId);
    if (!pkEstado) throw new Error('coloque um pokémon em campo');
    const espPk = especies.get(pkEstado.speciesId);
    if (!espPk) throw new Error('espécie do pokémon fora do catálogo');
    const pk = { level: pkEstado.level, stats: pkEstado.stats, ivs: pkEstado.ivs ?? {}, tipos: pkEstado.tipos?.length ? pkEstado.tipos : tiposDe(espPk) };
    const golpes = golpesDoPokemon(m, pk, espPk);
    const ctx = {
      tabelaTipos: w.tabelaTipos, ampliacaoHunt: w.ampliacaoHunt, multHpSelvagem: w.multHpSelvagem, multDanoSelvagem: w.multDanoSelvagem,
      tipoDoDia: eu.diaSazonal && agora < (eu.diaSazonal.fim ?? 0) ? eu.diaSazonal.tipo : null,
    };
    const tiposBoost = w.tiposBoost ?? [];
    const multTr = m.analyser.multXpTreinador(eu, agora, tiposBoost);
    const multPk = m.analyser.multXpPokemon(eu, agora, tiposBoost);
    const bonusLoot = m.analyser.bonusLootPct(eu, agora, tiposBoost, eu.evento?.farmPct ?? 0);
    const meuHp = Math.max(REGRA.hpMin, Math.round(pk.stats.hp * REGRA.hpMult));

    const avaliar = (h, morto) => {
      const total = (h.especies ?? []).reduce((s, e) => s + (Number(e.pontos) || 0), 0) || 1;
      const r = { luta: 0, danoAbate: 0, efPior: Infinity, melhor: null, xpKill: 0, ouroKill: 0 };
      for (const e of h.especies ?? []) {
        const id = m.outland.isOutlandPokeIdLegado?.(e.pokeId) ? m.outland.remapOutlandPokeId(e.pokeId) : e.pokeId;
        const alvo = especies.get(id);
        if (!alvo) return null;
        const peso = (Number(e.pontos) || 0) / total;
        const s = simularContra(m, ctx, pk, golpes.map((g) => ({ ...g })), alvo, h.nivel, morto);
        if (!s) return null;
        r.luta += peso * s.lutaS;
        r.danoAbate = Math.max(r.danoAbate, s.danoPorAbate);
        r.efPior = Math.min(r.efPior, s.efMelhor);
        r.melhor ??= s.melhor;
        r.xpKill += peso * m.recompensa.xpPorDerrota(h, h.nivel, alvo);
        r.ouroKill += peso * m.recompensa.ouroPorDerrotaHunt(h, h.nivel, alvo, bonusLoot);
      }
      return r;
    };

    // tempo morto medido por hunt
    const medido = opcoes.medido ?? {};
    const mortoDe = {};
    for (const h of w.hunts ?? []) {
      const kph = Number(medido[h.slug]);
      if (!kph) continue;
      const r = avaliar(h, 3.3);
      if (r) mortoDe[h.slug] = Math.max(0.2, 3600 / kph - r.luta);
    }
    const mortoPadrao = mediana(Object.values(mortoDe)) ?? 3.3;

    // Outland: o tier que vale agora (o escolhido, limitado pelo nível) e o melhor que o nível libera
    const tiers = w.outlandTiers ?? [];
    const liberados = tiers.filter((x) => eu.level >= x.nivel);
    const melhorTier = liberados.at(-1) ?? tiers[0] ?? { tier: 1, mult: 1 };
    const tierAtual = liberados.find((x) => x.tier === eu.outlandTier) ?? melhorTier;
    const drops = [
      { id: 'bossToken', nome: 'Bronze Boss Token', chance: Number(w.chanceBossToken) || 0 },
      { id: 'fragChave', nome: 'Fragmento de Chave', chance: Number(w.casas?.fragmento?.chanceDrop) || 0 },
      { id: 'fragShiny', nome: 'Fragmento de Shiny Stone', chance: Number(w.shinyStone?.chanceDrop) || 0 },
      { id: 'fragBicicleta', nome: 'Fragmento de Bicicleta', chance: Number(w.bicicletas?.fragmento?.chanceDrop) || 0 },
    ];
    const multLoot = 1 + bonusLoot / 100;

    const linhas = [];
    for (const h of w.hunts ?? []) {
      const liberada = eu.level >= h.nivel;
      if (opcoes.soLiberadas !== false && !liberada) continue;
      const morto = mortoDe[h.slug] ?? mortoPadrao;
      const r = avaliar(h, morto);
      if (!r) continue;
      const porAbate = r.luta + morto;
      const kph = 3600 / porAbate;
      const abatesPorVida = r.danoAbate > 0 ? meuHp / r.danoAbate : Infinity;
      // Com poção automática a cura é instantânea entre golpes: o perigo é morrer DENTRO de um abate.
      const risco = r.danoAbate >= meuHp ? 'morre' : (opcoes.comPocao === false && abatesPorVida < 5) ? 'arriscada' : 'segura';
      const linha = {
        slug: h.slug, nome: h.nome, area: h.area, regiao: h.regiao ?? h.area, nivel: h.nivel, liberada,
        kph: Math.round(kph), sPorAbate: +porAbate.toFixed(1), ritmo: mortoDe[h.slug] != null ? 'medido' : 'estimado',
        xpPokemonH: Math.round(kph * r.xpKill * multPk), xpTreinadorH: Math.round(kph * r.xpKill * multTr), ouroH: Math.round(kph * r.ouroKill),
        risco, abatesPorVida: Number.isFinite(abatesPorVida) ? Math.round(abatesPorVida) : null, melhorGolpe: r.melhor, efetividade: +r.efPior.toFixed(2),
      };
      if (h.area === 'outland') {
        linha.dropsH = Object.fromEntries(drops.map((d) => [d.id, kph * d.chance * tierAtual.mult * multLoot]));
        linha.dropsHMelhorTier = Object.fromEntries(drops.map((d) => [d.id, kph * d.chance * melhorTier.mult * multLoot]));
      }
      linhas.push(linha);
    }
    const seguras = linhas.filter((l) => l.risco !== 'morre');
    const shiny = cacaShiny(m, especies, w, eu, agora, seguras, max0(opcoes));
    const max = opcoes.max ?? 10;
    return {
      pokemon: { nome: espPk.name, nivel: pk.level, tipos: pk.tipos },
      treinador: { nivel: eu.level, huntAtual: eu.huntSlug ?? null },
      bonus: { multXpTreinador: +multTr.toFixed(2), multXpPokemon: +multPk.toFixed(2), lootPct: Math.round(bonusLoot), tipoDoDia: ctx.tipoDoDia },
      ritmo: { mortoPadraoS: +mortoPadrao.toFixed(1), medidas: Object.keys(mortoDe).length },
      outland: { tierAtual, melhorTier, tiers, drops: drops.map(({ id, nome, chance }) => ({ id, nome, chance })), multLoot: +multLoot.toFixed(2) },
      economia: w.economia ?? null,
      porXp: [...seguras].sort((x, y) => y.xpPokemonH - x.xpPokemonH).slice(0, max),
      porOuro: [...seguras].sort((x, y) => y.ouroH - x.ouroH).slice(0, max),
      outlands: seguras.filter((l) => l.area === 'outland').sort((x, y) => y.kph - x.kph).slice(0, max),
      atual: linhas.find((l) => l.slug === eu.huntSlug) ?? null,
      total: linhas.length,
      shiny,
    };
  }

  const max0 = (o) => o.max ?? 10;

  /**
   * CAÇA SHINY — pelas regras do capítulo Shiny e Captura do Pokepédia do jogo:
   *   · o brilho é sorteado no ARREMESSO da bola (chanceShiny, a mesma para toda espécie com forma shiny);
   *   · é UMA bola por corpo, e o shiny que escapa vai embora com o corpo → shiny capturado = chanceShiny × captura;
   *   · captura num corpo caído = base × (eficiência da bola ÷ fator do estágio) × 1,4, entre o piso e o teto;
   *   · Capture Boost multiplica a captura (respeitando o teto) e o Shiny Secret Lure multiplica o shiny;
   *   · na Outland o shiny não rola.
   * Taxa (Poisson) por hora: λ = abates/h × Σ peso × [tem shiny] × chanceShiny × captura.
   */
  function cacaShiny(m, especies, w, eu, agora, seguras, max) {
    const chance = Number(w.chanceShiny) || 0;
    const bolas = (w.catalogoBolas ?? []).filter((b) => Number(b.catchRate) > 0);
    if (!chance || !bolas.length) return { erro: 'sem-dados' };
    const cap = { base: 0.0075, piso: 0.003, teto: 0.1, raridadeDiv: 17, precoSemPreco: 6.5e9, ...(w.captura ?? {}) };
    const porRate = (a, b) => Number(b.catchRate) - Number(a.catchRate);
    const topo = [...bolas].sort(porRate).find((b) => /beast/i.test(b.nome)) ?? [...bolas].sort(porRate)[0];
    const ouro = [...bolas].filter((b) => b.compravel && Number(b.priceGold) > 0).sort(porRate)[0] ?? null;
    const shinyDex = new Set((w.shinyDex ?? []).map(String));
    const chaves = m.degrau.chavesEmHunt(w.hunts);
    const dexBase = (id) => (id >= 13000 ? id % 1000 : m.formas.dexBaseDaForma?.(id) ?? id);
    const temShiny = (id) => !m.outland.isOutlandPokeId?.(id) && shinyDex.has(String(dexBase(id)));
    const multDe = (chave) => (agora < (eu.loja?.boosts?.[chave] ?? 0) ? (w.tiposBoost ?? []).find((b) => b.chave === chave)?.mult ?? 2 : 1);
    const multBoost = (chave) => (w.tiposBoost ?? []).find((b) => b.chave === chave)?.mult ?? 2;
    const ativos = { captura: multDe('captura'), shiny: multDe('shiny') };
    const capturaDe = (esp, rate, multCap) => {
      if (rate >= 255) return 1;
      const preco = esp.priceNpc > 0 ? esp.priceNpc : cap.precoSemPreco;
      const fator = m.degrau.fatorDeCaptura({
        tetoCaptura: m.teto.tetoDeCaptura(esp.pokeId, especies.estagios), peloDegrau: m.degrau.capturaPeloDegrau(esp.pokeId, chaves),
        preco, raridadeDiv: cap.raridadeDiv ?? 17, porDegrau: cap.porDegrau,
      });
      const p = Math.max(cap.piso, Math.min(cap.teto, cap.base * (rate / fator) * 1.4));
      return Math.min(cap.teto, p * multCap);
    };
    // Os quatro cenários de boost, para as duas bolas: λ por hora.
    const CENARIOS = { nenhum: [1, 1], captura: [multBoost('captura'), 1], lure: [1, multBoost('shiny')], ambos: [multBoost('captura'), multBoost('shiny')] };
    const linhas = [];
    for (const l of seguras) {
      if (l.area === 'outland') continue;
      const h = (w.hunts ?? []).find((x) => x.slug === l.slug);
      const total = (h?.especies ?? []).reduce((s, e) => s + (Number(e.pontos) || 0), 0) || 1;
      let fracShiny = 0, frac1 = 0;
      const termos = [];
      for (const e of h?.especies ?? []) {
        const esp = especies.get(e.pokeId);
        if (!esp) continue;
        const peso = (Number(e.pontos) || 0) / total;
        if (!temShiny(esp.pokeId)) continue;
        fracShiny += peso;
        if (m.teto.tetoDeCaptura(esp.pokeId, especies.estagios) === 20) frac1 += peso;
        termos.push({ esp, peso });
      }
      if (!fracShiny) continue;
      const lambda = (bola, multCap, multShiny) => !bola ? 0
        : l.kph * chance * multShiny * termos.reduce((s, t) => s + t.peso * capturaDe(t.esp, Number(bola.catchRate), multCap), 0);
      const tabela = (bola) => Object.fromEntries(Object.entries(CENARIOS).map(([k, [c, s]]) => [k, lambda(bola, c, s)]));
      linhas.push({
        slug: l.slug, nome: l.nome, regiao: l.regiao, nivel: l.nivel, kph: l.kph, ritmo: l.ritmo, risco: l.risco, ouroH: l.ouroH,
        fracShiny: +fracShiny.toFixed(3), frac1oEstagio: +frac1.toFixed(3),
        vistosH: l.kph * chance * ativos.shiny * fracShiny,
        topo: { agora: lambda(topo, ativos.captura, ativos.shiny), ...tabela(topo) },
        ouro: ouro ? { agora: lambda(ouro, ativos.captura, ativos.shiny), ...tabela(ouro) } : null,
        custoOuroH: ouro ? l.kph * Number(ouro.priceGold) : null,
        especies: termos.sort((a, b) => b.peso - a.peso).slice(0, 4).map((t) => ({
          nome: t.esp.name, peso: +t.peso.toFixed(3), teto: m.teto.tetoDeCaptura(t.esp.pokeId, especies.estagios),
          capTopo: capturaDe(t.esp, Number(topo.catchRate), ativos.captura), capOuro: ouro ? capturaDe(t.esp, Number(ouro.catchRate), ativos.captura) : null,
        })),
      });
    }
    return {
      chance, ativos, multBoost: { captura: multBoost('captura'), shiny: multBoost('shiny') },
      vip: agora < (eu.loja?.vipAte ?? 0),
      bolaTopo: { nome: topo.nome, catchRate: topo.catchRate, priceGold: topo.compravel ? topo.priceGold ?? null : null },
      bolaOuro: ouro ? { nome: ouro.nome, catchRate: ouro.catchRate, priceGold: ouro.priceGold } : null,
      porTopo: [...linhas].sort((a, b) => b.topo.agora - a.topo.agora).slice(0, max),
      porOuro: ouro ? [...linhas].sort((a, b) => b.ouro.agora - a.ouro.agora).slice(0, 3) : [],
    };
  }

  window.__launcherHunt = { calcular, versao: 2 };
})();
