# Política de segurança

## Versões com suporte

Somente a versão mais recente publicada em [Releases](../../releases) recebe correções.

## Como reportar uma vulnerabilidade

Por favor, **não abra uma issue pública** para falhas de segurança.

Use o recurso de reporte privado do GitHub: aba **Security → Report a vulnerability** deste repositório. Descreva:

- o que acontece e qual o impacto;
- passos para reproduzir;
- versão do launcher e do Windows.

A resposta deve vir em até 7 dias. Depois da correção, o problema é descrito nas notas da release, com crédito a quem reportou (se a pessoa quiser).

## O que está no escopo

- O código deste repositório (`src/`) e os executáveis publicados em Releases.
- Formas de uma página carregada no launcher acessar o sistema, arquivos ou outras contas.
- Formas de os dados do launcher saírem da máquina sem ação do usuário.

Fora do escopo: o jogo Pokéidle.io em si e vulnerabilidades do Chromium/Electron já corrigidas em versões mais novas (nesse caso, avise para atualizarmos).

## Modelo de segurança, em resumo

- Interface e contas rodam com `sandbox`, `contextIsolation` e sem `nodeIntegration`.
- Todo `<webview>` é validado pelo processo principal antes de ser criado: só `https://pokeidle.io`, com o preload do launcher.
- Os cards não navegam para fora do Pokéidle; links externos abrem no navegador padrão.
- Permissões sensíveis do navegador (câmera, microfone, localização, notificações) são negadas.
- O launcher não faz requisições de rede próprias e não tem telemetria.

Detalhes completos na seção **Segurança e privacidade** do [README](README.md#-segurança-e-privacidade).
