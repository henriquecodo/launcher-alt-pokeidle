# Avisos de terceiros

Este projeto usa ou se inspira nos seguintes trabalhos de terceiros.

## Electron

O executável inclui o [Electron](https://github.com/electron/electron) (licença MIT), que por sua vez inclui o Chromium e o Node.js. As licenças completas desses componentes acompanham o executável (`LICENSE.electron.txt` e `LICENSES.chromium.html`).

## Lucide

Os ícones em [`src/renderer/icons.js`](src/renderer/icons.js) são baseados no conjunto [Lucide](https://lucide.dev).

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Onde caçar? e Outland & renda

O motor **Onde caçar?** ([src/game/hunt-engine.js](src/game/hunt-engine.js)) é código próprio do launcher. As regras de combate seguem o que o próprio jogo publica no Pokepédia, e os cálculos usam os módulos de regras do jogo (`pokeidle.io/shared/*.mjs`) e o catálogo de espécies, importados ao vivo dentro da conta, no seu computador. O launcher **não** inclui nem redistribui esses módulos.

A ideia de um painel "onde caçar" dentro do jogo veio das ferramentas da comunidade: o Guia HardToCapture (usado até a 1.0), a extensão [/hunt for PokeIdle](https://chromewebstore.google.com/detail/mhnplloljgchpfpcpbhmcokmnefodjnh) (embutida na 1.1 e removida na 1.2, quando parou de funcionar) e o site da comunidade pokeidle-gg. Nenhum código delas faz parte do launcher.

## Pokémon / Pokéidle.io

Pokémon é marca registrada da Nintendo, Game Freak, Creatures Inc. e The Pokémon Company. Pokéidle.io pertence aos seus respectivos donos. Este projeto não tem vínculo com nenhum deles e não distribui nenhum recurso (imagens, sons, código) do jogo — o jogo é carregado diretamente do site oficial.
