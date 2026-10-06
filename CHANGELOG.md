# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o versionamento segue o [SemVer](https://semver.org/lang/pt-BR/).
As versões 0.x foram as etapas de desenvolvimento antes do lançamento público, todas em 2026-10-06.

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
