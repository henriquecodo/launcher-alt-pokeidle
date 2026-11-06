# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento segue o [SemVer](https://semver.org/lang/pt-BR/).
As versões 0.x foram as etapas de desenvolvimento antes do lançamento público, todas em 2026-10-06.

## [1.2.0] — 2026-11-06 · Onde caçar e renda da Outland

O jogo chegou à v1.401 e a extensão "/hunt for PokeIdle" parou de funcionar. O launcher passa a ter a sua própria calculadora.

### Adicionado
- **Onde caçar? próprio** (troféu do card ou **Onde caçar** na barra): simula o pokémon em campo contra cada hunt liberada com as regras de combate do Pokepédia — STAB, efetividade com a ampliação da hunt, cooldown de cada golpe, Investida, IV de Velocidade, HP e dano multiplicados dos selvagens — e as funções de XP/ouro do próprio jogo, importadas ao vivo de `pokeidle.io/shared/`. Top 10 por XP/h, com abates/h e risco. O motor só é injetado quando você abre o painel, e o catálogo sai da memória 3 min depois.
- **Ritmo medido:** depois de 10 min na mesma hunt, o launcher lê a prancheta de sessão do jogo (`sessao-hunt:<nick>`) e guarda os abates/h reais daquela conta naquela hunt; as hunts ainda não medidas usam a mediana das medidas da conta.
- **Outland & renda:** Bronze Boss Tokens e fragmentos (Chave, Shiny Stone, Bicicleta) por dia na Outland mais rápida para o seu pokémon, com o tier atual e o bônus de loot; em Gemas já sem a taxa do Mercado, em USDT e em dias até o saque mínimo. Avisa quando o nível já libera um tier melhor e mostra os drops reais medidos em cada hunt.
- **Preços do Mercado da Comunidade:** abriu o mercado (Fragmentos ou Boss Tokens) em qualquer conta, o launcher guarda o menor anúncio de cada item.

### Alterado
- "Ir para" acompanha os rótulos novos do jogo (Pokedex sem acento, **Mini Games**) e compara sem acento nem caixa.

### Removido
- A extensão /hunt, o ajuste dela e a conferência diária na Chrome Web Store. A pasta `extensions` antiga é apagada ao abrir.

## [1.1.1] — 2026-10-19 · Hotfix: farm que não para

O farm do Pokéidle roda no **servidor** enquanto a conexão (WebSocket) de cada conta estiver viva; o jogo pinga a cada 25 s e o servidor derruba quem fica ~60 s calado. Não existe farm offline: desconectada, a conta perde a hunt em 90 s.

### Corrigido
- **Contas paravam de farmar com o PC ausente.** Em notebooks com *Modern Standby* (o "S0 Ocioso com Baixo Consumo" do Windows — em muitos, o único "sono" que existe), quando você fica ausente e a tela apaga o Windows entra em espera e **congela os programas comuns**: a conexão cai e o servidor para a hunt. Nenhum programa farma nesse estado. O launcher agora **reconecta tudo na volta** e oferece **"Não deixar o PC dormir"** para quem quer farmar ausente (só a tela apaga).
- Proteção extra contra a economia de timers de página escondida (`IntensiveWakeUpThrottling`, `QuickIntensiveWakeUpThrottlingAfterLoading`, `UseEcoQoSForBackgroundProcess`). Testado: com o launcher minimizado por 8 min os timers das contas seguem a cada 10 s, com ou sem essa proteção — minimizar nunca foi o problema.
- **Volta do sono/hibernação e desbloqueio da tela:** o launcher cutuca a reconexão de todas as contas na hora (em escadinha), em vez de esperar o jogo perceber.
- **/hunt parado na versão 1.0.1:** o atualizador baixava versões novas mas continuava carregando a antiga. Agora a versão é escolhida pelo que está no disco e a nova é buscada antes de carregar.

### Adicionado
- **Vigia de conexão:** 90 s sem nenhuma mensagem do servidor → "cutucão" de reconexão; se em 1 min não voltar → recarrega a conta. Conta aberta em outro lugar ("Jogar aqui") nunca é tomada de volta sozinha, e o card mostra "aberta em outro lugar" / "reconectando…".
- **Sem cena quando ausente** (ligado por padrão): com o PC ausente (5 min sem uso ou tela bloqueada) ou o launcher minimizado, tira a cena das contas — menos RAM/CPU, a caça continua — e religa na volta, só onde o launcher desligou.
- **Farmar com o Windows bloqueado** (ligado por padrão): ao bloquear com Win+L, o launcher pede ao Windows para não entrar em espera por ociosidade enquanto estiver bloqueado (a tela apaga normalmente) — no Modern Standby, a tela apagar depois do bloqueio punha o PC em espera e congelava o jogo. Desbloqueou, o pedido sai. Tampa fechada e "Suspender" continuam dormindo.
- **Não deixar o PC dormir** (opcional, desligado por padrão): o mesmo pedido, o tempo todo.

### Alterado
- **/hunt desligado por padrão** e, quando ligado, só na conta principal (ou em todas, se escolher): ele pré-carrega ~4 MB de dados do jogo e reprocessa cada pacote em cada conta onde roda.

## [1.1.0] — 2026-10-13 · Acompanhando o jogo

O jogo atualizou (v1.275): o guia virou a extensão oficial "/hunt for PokeIdle", entrou um aviso de cookies e a cena do Modo Economia ganhou botões próprios.

### Adicionado
- **/hunt oficial embutido:** a extensão "/hunt for PokeIdle" (indicada pelo jogo nos comandos `/guia` e `/hunt`) é baixada da Chrome Web Store, conferida (só pode rodar em `pokeidle.io`) e carregada em todas as contas. O troféu do card e o botão **/hunt** da barra abrem o "Onde caçar?". Atualização da extensão conferida 1×/dia. Ajuste para desligar.
- **Saúde das contas:** "Destravar conta parada" (XP parado por 15 min → recarrega) e "Atualização preventiva" (F5 a cada 2/4/6/12 h, padrão 6 h, contas com 3 min de diferença). Nenhum dos dois age se você mexeu na conta nos últimos 10 min.
- **Animação a 30 FPS** (ligada por padrão): a cena é desenhada na metade dos quadros; o jogo move tudo pelo tempo, então a caça não muda.
- **Modo Economia em massa** no menu Automações.
- Com "Bloquear rastreadores" ligado, o novo aviso de cookies do jogo é respondido com "Recusar" (só se ainda não houver escolha).

### Corrigido
- Ligar/desligar a cena às vezes travava até reiniciar o launcher: ele regravava `cfg-economia` a cada 2 s e brigava com o botão "Ligar a cena" do jogo. Agora o jogo guarda a escolha e o launcher usa os botões dele (`#hunt-eco`, `#arena-eco`, `#eco-sair`).
- O som também deixou de ser regravado a cada 2 s: o launcher aplica o mudo uma vez e o jogo passa a mandar.

### Removido
- "Melhores hunts" via Guia HardToCapture (o site saiu do ar e foi substituído pela extensão). Saem junto a leitura da ficha do pokémon e de VIP/evento, que rodava a cada 2 s em cada conta.

## [1.0.0] — 2026-10-06 · Lançamento

Primeira versão pública: tudo das versões 0.x reunido, com a base testada numa noite inteira de farm com várias contas.

### Adicionado
- Repositório open-source (licença MIT) com README, política de segurança, avisos de terceiros e build automático do executável no GitHub Actions (com SHA-256 publicado em cada release).

## [0.8.1] — Hotfix: pop-up

### Corrigido
- O modo "pop-up" do jogo derrubava o launcher. A Picture-in-Picture de documento (`DocumentPictureInPictureAPI`) é desligada em cada conta e a de vídeo é removida pelo preload; sem elas o jogo usa o cartão dentro da página.

### Adicionado
- Recuperação automática: se o processo do jogo de uma conta cair (`render-process-gone`), só aquele card recarrega; se a interface cair, a janela recarrega.

## [0.8.0] — Melhores hunts

### Adicionado
- Painel **Melhores hunts** por conta: top 5 de hunts (XP/h, dinheiro/h, nível, região, selo) e nível seguro de farm, calculados pela aba "Onde caçar" do Guia HardToCapture.
- Leitura da ficha do pokémon quando ela é aberta no jogo, além de VIP e bônus de evento.
- Consulta ao guia em uma sessão própria (`persist:guia`), escondida, sem preload, travada no domínio do guia e fechada logo após a leitura. Resultado guardado por 30 min ou até a ficha/nível mudarem.

## [0.7.0] — Sempre logado

### Adicionado
- Contas continuam logadas entre aberturas: cópia de segurança da sessão do jogo, devolvida quando o jogo a descarta por falha passageira (e apagada quando você clica em **Sair**). Ajuste **Manter contas logadas**.
- Abertura escalonada das contas (uma a cada 3 s).
- Recarga automática quando o captcha do login falha (até 3 vezes a cada 5 min).
- Bloqueio de rastreadores de anúncio/analytics (Google Analytics, Tag Manager, DoubleClick, Pixel do Facebook), com ajuste para desligar.
- Mudo por conta também desliga o som dentro do jogo (`cfg-som`).

### Alterado
- Dados das contas gravados em disco a cada minuto e ao fechar (`flushStorageData`).
- Corretor ortográfico e back-forward cache desligados para economizar memória.

## [0.6.0] — Open-source

### Alterado
- Código reorganizado em `src/` (processo principal, preloads, interface, assets).
- Electron atualizado de 33 para 44.

### Segurança
- `sandbox`, `contextIsolation` e sem `nodeIntegration` na interface e em todas as contas.
- Validação de todo `<webview>` no processo principal (`will-attach-webview`), com o preload imposto pelo launcher.
- Permissões sensíveis negadas (câmera, microfone, localização, notificações).
- Interface sem navegação nem janelas, com Content-Security-Policy `default-src 'none'`.
- Removida a porta de depuração usada no desenvolvimento.

## [0.5.0] — Visual macOS

### Alterado
- Interface redesenhada: grafite neutro, ícones vetoriais (estilo Lucide) no lugar de emojis, barra de título integrada à barra de ferramentas.
- Seletor de contas deslizante, switches no estilo iOS, menus com animação, dicas ao passar o mouse e avisos discretos (toasts).

## [0.4.0] — De 1 a 4 contas

### Adicionado
- Seletor de quantas contas rodar (1 a 4); contas desligadas não criam processo.
- Layout automático: 2×2, principal em destaque com 3, lado a lado com 2.
- Modo otimizado e Night Mode ligados automaticamente em todas as contas.
- Modo Economia do jogo por conta.
- Nomes dos cards salvos; nome padrão trocado pelo nick do jogo.

## [0.3.0] — Captcha e zoom automático

### Corrigido
- O captcha da Cloudflare recusava o login dentro do launcher; as contas passam a se identificar como Chrome comum.

### Adicionado
- Zoom automático que encaixa a HUD inteira do jogo em cada card.
- XP ganho na sessão, por conta e somado, com botão para zerar.
- Botão para abrir o guia do jogo.

## [0.2.1] — Hotfix: navegação

### Corrigido
- "Login com Google" prendia o card numa página fora do jogo. As contas passam a ficar travadas em `pokeidle.io`.

### Adicionado
- Botão **início** em cada card.

## [0.2.0] — Executável e RAM

### Adicionado
- Executável portátil `Launcher Alt - PokeIdle.exe` com ícone da pokébola.
- Gestão de memória: modo low-end do Chromium, limite de heap por conta, limpeza de cache a cada 30 min.
- Farm que não pausa com a janela minimizada ou coberta.
- Monitor de RAM total e por conta, com reinício automático opcional por limite.

## [0.1.0] — Protótipo

### Adicionado
- 4 contas em sessões isoladas (`persist:conta1`…`4`) numa grade 2×2.
- Zoom por painel, XP/h por conta e total, ouro.
- Controle das 5 automações do jogo por conta e em todas, com reaplicação ao logar.
- Atalhos "Ir para" (Mapa, Market, Boss, Pokédex), atualizar e mutar todas.
