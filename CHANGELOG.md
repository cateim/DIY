# Changelog

Todas as mudanças notáveis deste repositório são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
As versões seguem o esquema **CalVer `YYYY.M.R`** (ano, mês sem zero à esquerda, revisão do mês), **não** o Versionamento Semântico: `2026.8.1` não diz nada sobre compatibilidade, só quando o conteúdo foi publicado.

## [Unreleased]

### ✨ Added

- **Guia do Omarchy no notebook** ([`docs/omarchy.md`](./docs/omarchy.md), arquivos em [`assets/omarchy/`](./assets/omarchy/)): inventário de tudo o que foi mudado de propósito no Omarchy 4 do Alienware desde a instalação em 31/10/2026 (atalhos e monitores do Hyprland, barra e plugins do shell, prompt, git, acesso remoto, drive-sync, `/etc`, pacotes adicionados e removidos) e um espelho para reinstalar do zero. O `export.sh` copia do sistema para o repositório trocando dados pessoais (domínio, e-mail, nomes dos servidores, `.onion`) por placeholders `<<NOME>>` e se recusa a terminar se achar senha, token, chave, IP privado, e-mail ou `.onion`; o `install.sh` devolve cada arquivo com backup `.bak.<epoch>`, com `--dry-run` e `--system`. Os valores reais ficam no `~/.config/diy-omarchy/private.env`, fora do git, com cópia no Bitwarden. Entram também o plugin `cateim.window-switcher` (Alt+Tab com miniaturas ao vivo, submap do Hyprland) e o `scripts/ssh-no-boot.sh` (desbloqueio do LUKS por SSH no boot), que agora lê IP e chaves do `private.env`.
- **Guia do Portainer Agent** ([`docs/portainer-agent.md`](./docs/portainer-agent.md)): liga outra máquina com Docker ao Portainer central pelo IP do Tailscale, sem instalar um segundo Portainer nela. Cobre o bloco do `ufw-docker` do Omarchy, que libera qualquer rede privada e bloqueia o Tailscale, as duas regras que deixam só o servidor entrar na porta 9001 e a ordem delas (um `allow` depois do `deny` dá `context deadline exceeded`), como fica o `/srv` (o agent não guarda nada, o compose fica no servidor e os dados em `/srv/<projeto>` da máquina) e a atualização manual do agent quando o servidor muda de versão. Aplicado no notebook `alienware` em 03/11/2026.
- **Guia do REA, engenharia reversa com agentes** ([`docs/rea.md`](./docs/rea.md)): o que é o `rea-agents` (servidor MCP com 229 ferramentas e a CLI `rea`), como ele responde com Evidence (hash do alvo, confiança e limitações) e onde entra no nosso desenvolvimento: firmware ESP32, API de app de fabricante para integrações do Home Assistant, scraping e bookmarklets, o que o `dist/` dos nossos apps entrega ao navegador e a versão do Go dos binários do homelab. Cobre a instalação global no Node do mise (o único script de instalação é o do Frida, que cai no `make` e compila tudo se o download falhar), o registro só no Claude Code com `rea setup`, o que já funciona sem motor nativo e o que cada motor opcional destrava (Ghidra, binwalk, tshark, sigrok, JADX). O leitor de imagens ESP32 está no `main` do REA, mas não na 6.8.0 publicada: testado, o `jade.bin` responde `unsupported binary format`. Instalado e testado no notebook `alienware` em 03/11/2026; o Ghidra 12.1.2 do Arch entrou como motor nativo em 04/11 (o REA acha o `/opt/ghidra` sozinho, e o caminho e o `JAVA_HOME` ficaram fixos no `env` do registro), com decompilação testada pela CLI e pelo MCP. Traz também um tutorial de uso (Partes 4 e 5): os sete verbos do REA, onde abrir a sessão (uma bancada por alvo em `~/Work/re/<alvo>/`, fora do `~/Drive`, com investigação e implementação em sessões separadas em vez de um projeto por solução), as cinco partes de um pedido eficiente e receitas prontas por caso. Registra ainda, medido em 04/11, que o snapshot do `close_binary` guarda as respostas com a Evidence mas não a análise do Ghidra: reabrir com ele refaz a auto-análise, então as perguntas sobre um binário ficam numa sessão só.
- **Atalhos do Windows e do Hyprland pelo web client do CortenDesk** ([`docs/rustdesk-server.md`](./docs/rustdesk-server.md), Parte 6): o guia diz agora que a tecla Win, o Alt+Tab e os atalhos SUPER só chegam ao computador remoto na tela cheia aberta pelo botão da própria sessão. Nela o CortenDesk chama `navigator.keyboard.lock()`, e o Chrome e o Edge passam a entregar à página as teclas que o Windows guardaria; o F11 do navegador não faz isso. Registra também que o CortenDesk nunca manda o CapsLock, o NumLock nem o ScrollLock como tecla, só o estado de cada um (`webclient/src/input/mouse-keyboard.ts`, `LOCK_CODES`), então trocar uma delas por SUPER no lado remoto não funciona por ele. Testado em 05/11/2026 no Windows do trabalho, conectando ao notebook.
- **Agente SSH no notebook** ([`docs/omarchy.md`](./docs/omarchy.md), Parte 5, passo 12): o `ssh-agent.socket` do `openssh` ligado e um bloco `Host *` no fim do `~/.ssh/config` (`AddKeysToAgent yes` e o `IdentityAgent` no socket do agente). A chave com senha dos servidores dos clientes pedia a senha a cada `ssh`; agora pede uma vez por login, e o Antigravity e o Claude Code, que não herdam o `SSH_AUTH_SOCK`, usam o mesmo agente. Conferido em 05/11/2026 em todos os servidores que usam essa chave. O `~/.ssh/config` fica fora do espelho, porque lista esses servidores.
- **Vigia das atualizações do Omarchy** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.8): o `vigia-omarchy` guarda uma cópia dos arquivos do Omarchy de que as personalizações dependem (clone do keyboard-layout, painel Display, peças do shell do window-switcher, tema do Chromium, modelos do `~/.config`, `omarchy-tools.toml` do mise) e a versão dos pacotes que importam (rustdesk, hyprland, xdg-desktop-portal-hyprland, quickshell, wayvnc, rclone). Depois de cada `omarchy update` e a cada início da sessão, avisa por notificação o que mudou e grava o diff num relatório; também acusa erro na config do Hyprland, atalho repetido, plugin `cateim.*` desligado e o shell do Omarchy rodando o código de antes da atualização. Testado com arquivos, pacotes e datas de instalação simulados; base gravada sobre o Omarchy 4.5.

### 🔧 Changed

- **No VNC da Cloudflare, o CapsLock vira SUPER** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.6): o teclado virtual do wayvnc passa do layout `br` para o `brvnc(super_caps)`, um ABNT2 em `~/.config/xkb/symbols/brvnc` em que o CapsLock mantém o keysym `Caps_Lock` mas age como SUPER. No Chrome e no Edge do Windows a tecla Win fica com o sistema e nunca chega à página, e o cliente da Cloudflare é obrigatório onde não dá para rodar VNC nativo. O CapsLock chega, então os atalhos SUPER do Hyprland voltam a funcionar pelo navegador. Como o keysym continua o mesmo, vale tanto para cliente que manda nome de tecla quanto para o que manda scancode (QEMU). O teclado físico do notebook não muda; no acesso remoto o CapsLock deixa de travar maiúsculas. Testado em 04/11/2026 com um wayvnc descartável e binds temporários e, no mesmo dia, no Windows do trabalho (CapsLock+Tab troca de área).
- **O login do Authelia sem app de origem leva para a landing `https://selflabs.org`** ([`assets/configs/authelia.yml`](./assets/configs/authelia.yml), `default_redirection_url`), e não mais para o `pdf.selflabs.org`, que era só o primeiro app protegido.
- **A sessão do Authelia dura mais** ([`assets/configs/authelia.yml`](./assets/configs/authelia.yml), [`docs/authelia.md`](./docs/authelia.md), Parte 6): `inactivity` de 5 minutos para 1 hora e `expiration` de 1 para 12 horas. Com os prazos antigos, o painel do `monitor.selflabs.org` deslogava sempre que a aba ficava parada. O cookie é um só para todos os `*.selflabs.org`, então o prazo novo vale para todos os apps; o guia explica o "Lembrar-me" (1 mês) para quem deixa o painel aberto o dia todo.
- **O ai-memory grava o nome de cada ferramenta nas observações** ([`assets/stacks/ai-memory.yml`](./assets/stacks/ai-memory.yml), [`docs/ai-memory.md`](./docs/ai-memory.md)): `AI_MEMORY_INGEST__RECORD_TOOL_NAMES=true`. Sem ela, as chamadas chegavam só como `tool non-file` ou `tool unknown`, sem dizer qual ferramenta rodou; agora o título vira `tool non-file: Bash` ou `tool unknown: ToolSearch`, e as chamadas de `Skill` e `Agent` do Claude Code guardam também a skill ou o tipo de subagente. Só entram identificadores, nunca argumentos. Aplicado no Orange Pi em 03/11/2026.
- **O espelho do Omarchy ganhou o motor nativo do REA** ([`assets/omarchy/packages.txt`](./assets/omarchy/packages.txt), [`docs/omarchy.md`](./docs/omarchy.md), Parte 4): `ghidra` e `jdk21-openjdk` numa seção própria da lista de pacotes, e o `npm install --global rea-agents` com o `rea setup` no ambiente de desenvolvimento. O JDK vai explícito porque o pacote do Ghidra só pede um `java-environment>=21` e o pacman perguntaria qual; o 21 é o que o REA verificou. Instalados no notebook em 03/11/2026.
- **O espelho acompanha as migrações do Omarchy 4.5** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Partes 3.1, 3.2 e 3.5): o `mise/config.toml` ficou sem `[tools]` (claude, codex, gh e o Node agora vêm de `/etc/mise/conf.d/omarchy-tools.toml`), o centro da barra virou `centerBegin`/`centerEnd` com o relógio mundial Elsewhen, a barra ficou transparente (mantida assim por escolha), o `bindings.lua` ganhou os atalhos antigos de ditado (`SUPER + CTRL + X` e `F9`) e as flags do Chromium e do Chrome ganharam `OverlayScrollbar`.
- **A barra voltou para o widget de teclado do Omarchy** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.2): o widget da 4.5 faz o que o clone `cateim.keyboard-layout` fazia (troca todos os teclados com a mesma lista de layouts por índice absoluto) e entende o fcitx5, que virou o teclado principal e que o clone descartava pelo nome. O `shell.json` usa o `omarchy.keyboard-layout` na mesma posição, e o vigia deixou de olhar os arquivos do widget.
- **O relógio mundial da barra mostra as suas cidades** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.2): o Elsewhen passou a listar São Paulo, Londres, Dubai, Tóquio e Los Angeles, em 24 h, no lugar do padrão (Los Angeles, Paris e Tóquio). A lista fica no `shell.json` desde 05/11/2026.
- **O `rustdesk-tela-unica` avisa e deixa o LG ligado se você ligar à mão** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.6): ao desligar o LG, uma notificação diz o IP da conexão. Em 05/11/2026 o CortenDesk reconectou sozinho e deixou uma sessão aberta por 46 min, e o LG desligava de novo a cada tentativa pelo painel. Agora, ligar o LG à mão depois dos primeiros 20 s da sessão vale até ela fechar (o mouse do cliente web pode errar nesse tempo); antes dos 20 s o serviço insiste, porque no começo da sessão o LG às vezes religa sozinho. Testado com `hyprctl`, `pgrep` e `notify-send` falsos.

### 🗑️ Removed

- **Clone `cateim.keyboard-layout`** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.2): apagado do notebook e do espelho depois que a troca entre us e br pelo widget original da barra funcionou, no notebook e pelo VNC (05/11/2026). A última versão fica no histórico do git (commit `c5b6531`).

### 🐛 Fixed

- **O `GDK_SCALE` estava em 2** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.1): o controle de escala do Omarchy tinha gravado `omarchy_gdk_scale = 2` e `omarchy_monitor_scale = 1.6` no `monitors.lua`. As telas não mudavam, porque cada uma tem regra com escala fixa (Alienware 1,25 e LG 1), mas o `GDK_SCALE=2` passava para todo app aberto depois, e os apps GTK do XWayland abriam com o dobro do tamanho. Os dois voltaram a 1, que é a menor escala arredondada, a regra do Omarchy 4.5 para o `GDK_SCALE`. Conferido em 05/11/2026: `GDK_SCALE=1` num processo aberto pelo Hyprland depois do reload, e as duas telas com a mesma escala, posição e frequência.
- **O mouse do RustDesk caía no monitor errado** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3): o `xdg-desktop-portal-hyprland` informa toda tela compartilhada na posição `(0,0)`, e o notebook ficava em `256x1080`, abaixo do LG. O RustDesk 1.5.1 só corrige essa posição quando mede um quadro da tela em 300 ms; com a tela parada, a medida falha, ele também deixa de converter a escala 1,25, e o cursor remoto ia parar no LG quando se apontava para o terço de cima do notebook. Agora o notebook fica em `0x0` e o LG em `-256x-1080`, o mesmo arranjo físico, e a posição `(0,0)` passa a estar certa. Testado em 04/11/2026 com um mouse uinput absoluto igual ao do RustDesk (cursor no ponto pedido, a 1 px, inclusive no LG) e confirmado pelo celular no mesmo dia.
- **No RustDesk pelo navegador (CortenDesk), o mouse errava cada vez mais para o canto de baixo à direita** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.6): com duas telas no Wayland, o servidor do RustDesk 1.5.1 passa a esperar o mouse em coordenada lógica, já com a escala 1,25 do notebook (`display_service.rs`, `update_sync_displays`). O app nativo converte, o cliente web manda a coordenada física. Com uma tela só, o servidor volta a aceitar a física e todo cliente acerta. O novo serviço de usuário `rustdesk-tela-unica` desliga o LG enquanto houver sessão do RustDesk e religa com `hyprctl reload` quando a última fecha; durante a sessão as janelas do LG ficam em outra área de trabalho do notebook. O LG sai já no pedido de conexão, lido do log do servidor, porque o servidor guarda o arranjo de telas no começo da sessão (`wayland.rs`, `set_wayland_layout_baseline`) e, se ele muda depois, converte o mouse do arranjo guardado para o atual (`display.rs`, `remap_to_live_layout`) enquanto o cliente já recebeu a lista nova: o erro de 1,25 voltava até a captura reiniciar. Com o LG desligado à mão, o cursor ficou certo no RustDesk web e no VNC (04/11/2026). Em 05/11/2026 a primeira versão do serviço, que só olhava o processo `rustdesk --cm` a cada 2 s, desligava o LG tarde demais, e o **Refresh video** do CortenDesk acertou o mouse na hora, o que confirmou a causa. A versão que lê o log foi testada com `hyprctl` e `pgrep` falsos (LG desligado 12 ms depois do pedido). Na sessão real das 16:37 do mesmo dia ela acertou: o LG saiu antes, e a sessão começou com uma tela só. Na das 16:22 o LG religou sozinho 5 vezes em 7 s depois do pedido, e a sessão começou vendo as duas telas; a causa desse religar ainda não é conhecida.
- **Depois da atualização para o Omarchy 4.5, `SUPER + SPACE` e `SUPER + ALT + SPACE` não faziam nada** ([`docs/omarchy.md`](./docs/omarchy.md), Parte 3.8 e Troubleshooting): o `omarchy update` não reiniciou o shell, que rodava desde 03/11 com o código da 4.0.6. Os atalhos da 4.5 chamam o atalho global `omarchy:menu.root` e o alvo `omarchy.dock`, que o shell antigo não tinha (`Target not found`, nenhum atalho global registrado). `omarchy restart shell` resolveu (32 atalhos globais registrados), e o `vigia-omarchy` passou a avisar quando o shell é mais velho que a instalação do pacote.
- **Ligar o LG pelo painel Display o punha à direita do notebook, a 60 Hz** ([`assets/omarchy/`](./assets/omarchy/), [`docs/omarchy.md`](./docs/omarchy.md), Parte 3.1): o painel liga a tela pelo nome da porta (`HDMI-A-4`), e a regra do LG no `monitors.lua` era só pela descrição, então o painel acabava numa regra vazia, com posição automática. O Omarchy 4.5 passou a manter modo e posição da regra que tem o mesmo nome, e o `monitors.lua` ganhou uma regra igual pela porta. Testado ao vivo com o comando que o painel roda: desligar pelo serviço ou pelo painel e ligar pelo painel volta em `-256x-1080` a 75 Hz.
- **A cópia da stack do ai-memory dava outro nome à rede** ([`assets/stacks/ai-memory.yml`](./assets/stacks/ai-memory.yml)): o `name:` era `ai-memory_net`, e o servidor usa `ai-memory-net`. Um deploy feito a partir do repositório criaria outra rede. Agora o `name:` é `ai-memory-net` e a chave do Compose continua `ai-memory_net`, como no servidor; trocar a chave obrigaria a recriar a rede.

### 🔐 Security

- **O ai-memory fica fixo na 3.3.3** ([`assets/stacks/ai-memory.yml`](./assets/stacks/ai-memory.yml), [`docs/ai-memory.md`](./docs/ai-memory.md)): a imagem deixa de seguir `latest`. A 3.3.3 para de gravar em claro senhas e chaves que um Bash do Claude Code imprime, como `"db_password": "..."`, `Authorization: Basic` ou uma chave de `.env` depois da primeira linha ([akitaonrails/ai-memory#1963](https://github.com/akitaonrails/ai-memory/issues/1963)). Com `latest`, o servidor continuava na 3.3.2, porque um redeploy comum do Portainer não baixa a imagem de novo. O guia agora explica como atualizar com a tag fixa e, no notebook, pelo AUR. O que já tinha sido gravado continua como estava. Aplicado no Orange Pi em 03/11/2026.

## [2026.10.1] - 2026-10-18

### ✨ Added

- **Guia do Dozzle** ([`docs/dozzle.md`](./docs/dozzle.md), stack em [`assets/stacks/dozzle.yml`](./assets/stacks/dozzle.yml)): o painel de logs, uso e saúde dos containers, na v11. Cobre a pasta `/data`, sem a qual a tela de Configurações não salva nada (nem o login), o login próprio pela tela ou por `users.yml` com papéis, o login pelo Authelia com os grupos `dozzle_*`, ações e shell desligados por padrão, a migração de um Dozzle antigo sem `/data`, as atualizações e alertas da v11, o healthcheck da documentação, conferido no Dozzle 11.3.2 do homelab em 15/10/2026, e a rede com nome próprio (`dozzle-net`), com a remoção da `dozzle_default` que a stack antiga deixou. O Dozzle do homelab já rodava, mas nenhum guia o descrevia.
- **Espelho do Caddyfile em uso** ([`assets/configs/caddy-Caddyfile`](./assets/configs/caddy-Caddyfile)): o arquivo da vps-oracle, linha por linha, com o bloco novo do `monitor.selflabs.org` (painel de monitoramento dos clientes da Hubb) atrás do Authelia e os quatro caminhos abertos de propósito (WebSocket dos agentes do Beszel, sinais, saúde e a marca dos e-mails de alerta), cada um com o motivo.
- **Marca Self-Labs e tema automático no portal do Authelia** ([`docs/authelia.md`](./docs/authelia.md), Parte 6.1): `theme: 'auto'` (segue o claro ou escuro do aparelho de cada um), `server.asset_path` e o logo e o favicon em [`assets/configs/authelia-assets/`](./assets/configs/authelia-assets/), aplicados na vps-oracle em 15/10/2026. O logo é o da Self-Labs em fundo transparente, gerado do SVG sem o retângulo de fundo.
- **Regra do `monitor.selflabs.org` no espelho do Authelia** ([`assets/configs/authelia.yml`](./assets/configs/authelia.yml)): com `default_policy: deny`, um host novo atrás do forward-auth sem regra própria responde 403 em todas as telas.

### 🔧 Changed

- **O guia do Docker + Portainer usa `apt` em vez de `apt-get`** ([`docs/portainer-debian.md`](./docs/portainer-debian.md)): os oito comandos de instalação e atualização do Docker. O `apt` é o comando de terminal desde o Debian 8, e o `apt-get` só continua útil em scripts.
- **O monitor.selflabs.org abriu os arquivos do app instalável no Caddy** ([`assets/configs/caddy-Caddyfile`](./assets/configs/caddy-Caddyfile)): `/manifest.webmanifest`, `/icones/*` e `/favicon.ico` passam sem o Authelia, porque o navegador busca o manifest sem cookie e o Android monta o ícone do app do lado do Google. Não trazem dado de cliente.
- **AdGuard, FrankMD, OpenList e ownCloud oCIS saíram da rede `bridge` padrão do Docker** ([`assets/stacks/adguard.yml`](./assets/stacks/adguard.yml), [`frankmd.yml`](./assets/stacks/frankmd.yml), [`openlist.yml`](./assets/stacks/openlist.yml), [`owncloud-ocis.yml`](./assets/stacks/owncloud-ocis.yml)): cada um ganhou a própria rede com nome (`adguard-net`, `frankmd-net`, `openlist-net`, `ocis-net`). Na `bridge` padrão, todo container de outra stack que também estivesse nela alcançava esses pelo IP; no homelab eram sete juntos (AdGuard, FrankMD, OpenList, oCIS, CUPS, Vaultwarden e o Portainer). As portas publicadas não mudam, então quem acessa pelo IP do servidor ou pelo Cloudflare Tunnel não percebe nada. Num servidor que já roda essas stacks, falta um redeploy de cada.
- **Primeiro login do Portainer** ([`docs/portainer-debian.md`](./docs/portainer-debian.md)): o token de setup que a tela pede agora está documentado.
- **O bloco do ALFERES no Caddyfile perdeu o rótulo "(P1)"**, no espelho e no servidor: o sistema vai além do módulo P1.
- **O Caddy entrou na rede `monitor-proxy`** ([`assets/stacks/caddy.yml`](./assets/stacks/caddy.yml), [`docs/caddy.md`](./docs/caddy.md)), que ele divide só com o painel de monitoramento da Hubb e o hub do Beszel. Na `caddy-net`, qualquer outro app do host chamaria os dois direto, sem passar pelo Authelia, e o painel não tem login próprio.
- **O guia do Forgejo sobe pelo Portainer primeiro** ([`docs/forgejo.md`](./docs/forgejo.md), Partes 2, 3 e 5.4), como os outros: a senha do banco vai na aba Environment variables da Stack, e o `docker compose up -d` com `.env` virou a alternativa via SSH. O runner que espera o `runner-config.yml` sobe sozinho (ou com `docker restart forgejo-runner`), sem redeploy da Stack.

- **O limite de requisições do DoH do AdGuard ganhou seção no guia** ([`docs/adguard.md`](./docs/adguard.md), Parte 8.3): a regra existia só no painel da Cloudflare. Desde 15/10/2026 ela também cobre os sinais do painel de monitoramento da Hubb (`/api/sinal/*`), porque o plano Free tem uma regra só por zona; o guia mostra a expressão inteira e pede para manter as duas metades.

### 🗑️ Removed

- **A Parte 4 do guia do Portainer, o Edge Agent assíncrono** ([`docs/portainer-debian.md`](./docs/portainer-debian.md)), com a porta `8000` do `docker run`, que só servia ao agente. Ela juntava vários hosts num Portainer central, e quem enxerga os servidores dos clientes da Hubb agora é o painel de monitoramento, que já mostra máquina, containers, serviços e backups de todos. Um servidor que já roda o agente continua funcionando; para tirar, `docker stop portainer_edge_agent && docker rm portainer_edge_agent` e remover o ambiente no Portainer central.

### 🐛 Fixed

- **README e convenções descreviam outra stack do Forgejo**: a linha do índice falava em Docker-in-Docker, mas o runner usa o Docker do host (DOOD) desde a 15.0.6, e o `CLAUDE.md` citava a tag `:15.0.2` como exemplo de versão fixa, quando a stack fixa a `:15.0.6` (LTS).
- **A linha da Armadilha de Choque no README listava sensores ultrassônicos** (HC-SR04 ou RCWL-1655); o guia usa o PIR DYP-ME003.
- **O guia do Caddy se contradizia sobre a compressão** ([`docs/caddy.md`](./docs/caddy.md), Parte 6): o aviso diz, com o erro medido, que `encode` no bloco global derruba o Caddy, e uma dica mais abaixo dizia que o `encode` global valia para todos os sites. A dica agora diz que um site sem `import comprimir` não comprime.

## [2026.9.1] - 2026-09-04

### 🔧 Changed

- **Authelia segue a tag `latest`** em vez da `4.39` fixa, como o resto das stacks; o guia do BentoPDF mostra a `latest` no exemplo de fixação de versão.

## [2026.8.1] - 2026-08-30

### ✨ Added

- **🖧 RustDesk Server self-hosted (hbbs/hbbr)** ([`docs/rustdesk-server.md`](./docs/rustdesk-server.md)), com a migração dos clientes e o console web CortenDesk na mesma stack.
- **🍱 BentoPDF** ([`docs/bentopdf.md`](./docs/bentopdf.md)): kit de PDF que roda todo no navegador; o container só serve estáticos.
- **💾 Backup Total da Orange Pi 5** ([`docs/orangepi5-backup-restore.md`](./docs/orangepi5-backup-restore.md)): Timeshift para os arquivos e o script do bootloader, com a restauração do zero.
- **🎬 Mídia: Plex, Jellyfin e \*arrs** ([`docs/midia.md`](./docs/midia.md)): stack endurecida, transcodificação por hardware (rkmpp) na Orange Pi e o método para medir a transcodificação.
- **🧬 Graphify** ([`docs/graphify.md`](./docs/graphify.md)): grafo de conhecimento de uma codebase, com a integração com o Obsidian.
- **Compressão no Caddy** ([`docs/caddy.md`](./docs/caddy.md)): as boas práticas, medidas num frontend real.
- **Portainer Edge Agent assíncrono** ([`docs/portainer-debian.md`](./docs/portainer-debian.md)) para gerenciar vários hosts de um Portainer só.

### 🔧 Changed

- **O BentoPDF substituiu o Stirling-PDF** como opção principal de PDF; o guia do Stirling voltou como a alternativa que processa no servidor.
- **Forgejo 15.0.6 LTS**, com Docker-outside-of-Docker como modo padrão do runner.
- **RustDesk Server segue a tag `latest`** em vez da `1.1.16` fixa.
- **Formatação Markdown normalizada** em todos os guias.

### 🗑️ Removed

- **O guia do Home Assistant e a stack dele** saíram daqui para o repositório próprio, [self-labs/homeassistant](https://github.com/self-labs/homeassistant), que reúne a infraestrutura e as automações da casa.

### 🐛 Fixed

- **CortenDesk:** a ponte WebSocket apontava para o alvo errado, e as permissões do SQLite estão documentadas.
- **BentoPDF:** `ROBOTS_NOINDEX` derrubava a imagem sem privilégios; o comando de backup agora arquiva `/srv/pdf`.
- **Mídia:** caminho da edição em massa do Sonarr v4 e o idioma dos metadados no Jellyfin.

## [2026.7.1] - 2026-07-31

### ✨ Added

- **🔀 Caddy compartilhado** ([`docs/caddy.md`](./docs/caddy.md)): roteia por hostname e impõe login (forward-auth do Authelia) nos apps protegidos. O Portainer passou a ser servido por ele, e o `/admin` do radar é protegido por um matcher de caminho, sem fechar o resto do site.
- **🔐 Authelia + lldap** ([`docs/authelia.md`](./docs/authelia.md)): SSO self-hosted com usuários ilimitados, notificações por SMTP e segundo fator TOTP.
- **📄 Stirling-PDF** ([`docs/stirling-pdf.md`](./docs/stirling-pdf.md)): atrás do Authelia, com o login próprio desligado, SMTP opcional pelo Resend e a troca da senha de admin.
- **🔗 Tailscale** ([`docs/tailscale.md`](./docs/tailscale.md)): tailnet para alcançar os serviços (o app de desktop do Stirling, o Portainer pela rede do Caddy).
- **🖥️ RDP no Navegador** ([`docs/cloudflare-browser-rdp.md`](./docs/cloudflare-browser-rdp.md)): RDP renderizado pelo Cloudflare Access para redes que bloqueiam a porta, com um script de diagnóstico de proxy corporativo.

### 🔧 Changed

- **CI/CD com GitHub Actions:** regras do runner e build de imagens arm64.
- **Formatação e estrutura** dos guias padronizadas.

## [2026.6.1] - 2026-06-15

### ✨ Added

- **🏦 Actual Budget** ([`docs/actual-budget.md`](./docs/actual-budget.md)) e **💰 Firefly III** ([`docs/firefly.md`](./docs/firefly.md)), os dois com importação de CSV do Mobills.
- **⚒️ Forgejo** ([`docs/forgejo.md`](./docs/forgejo.md)): Git self-hosted com Actions e Renovate, e a recuperação do CI depois de trocar o endereço `.onion` por um domínio.
- **🔗 n8n** ([`docs/n8n.md`](./docs/n8n.md)) e **📝 FrankMD** ([`docs/frankmd.md`](./docs/frankmd.md)).
- **HA Bridge** no guia do Home Assistant: emulação de lâmpadas Hue para a Alexa, com rede `host`.
- **Convenções para agentes** ([`CLAUDE.md`](./CLAUDE.md) e [`AGENTS.md`](./AGENTS.md)).

### 🔧 Changed

- **Repositório reorganizado:** guias em `docs/`, e os anexos em `assets/stacks/`, `assets/configs/` e `assets/datasheets/`.
- **AI-Memory:** imagem oficial do Docker Hub, fluxo de atualização e o comando do hook nativo no Windows.
- **n8n:** sem a variável `N8N_RUNNERS_ENABLED`, que o n8n marcou como obsoleta.

### 🔐 Security

- **Domínio e IP pessoais removidos** dos guias, e o tratamento de segredos endurecido (variáveis de ambiente, `.gitignore`).

## [2026.5.1] - 2026-05-28

### ✨ Added

- **☁️ Oracle Cloud Free Tier VPS (ARM) via Pay-As-You-Go** ([`docs/vps-oracle.md`](./docs/vps-oracle.md)).
- **🧠 AI-Memory** ([`docs/ai-memory.md`](./docs/ai-memory.md)): memória persistente para o Claude Code, com o servidor em Docker.

### 🔧 Changed

- **Instalação do Docker** com exemplos de stack.

## [2026.4.1] - 2026-04-28

### ✨ Added

- **🛡️ AdGuard Home** ([`docs/adguard.md`](./docs/adguard.md)): DNS com bloqueio para a rede toda e DoH externo pela Cloudflare, com o perfil de iOS e uma página de instalação dele publicada pelo GitHub Pages (`index.html`).
- **☁️ ownCloud oCIS** ([`docs/owncloud-ocis.md`](./docs/owncloud-ocis.md)) e **📂 OpenList** ([`docs/openlist.md`](./docs/openlist.md)).
- **Datasheets dos componentes** usados nos projetos (DYP-ME003, RCWL-1655, RE5V1C).

### 🐛 Fixed

- **Perfil DoH do iOS** com UUIDs únicos, e o endereço do painel da Cloudflare no guia do AdGuard.

## [2026.3.1] - 2026-03-28

### ✨ Added

- **⚙️ CI/CD com GitHub Actions + Self-Hosted Runner** ([`docs/cicd-github-actions.md`](./docs/cicd-github-actions.md)).
- **⚡ Armadilha de Choque Automática** ([`docs/armadilha-choque.md`](./docs/armadilha-choque.md)): malha eletrificada, loop de segurança, agendamento pelo Home Assistant e o ajuste do sensor PIR.

### 🔧 Changed

- **🖥️ RustDesk Headless** refeito sobre o usuário da sessão, mais robusto, com placeholders no lugar do usuário real.
- **🐳 Docker + Portainer** mais preciso.
- **💧 Bomba d'Água Automática:** sensor ultrassônico, gravação do Tasmota, automações do Home Assistant e ajuste do sensor.

## [2025.11.1] - 2025-11-16

### ✨ Added

- **Home Assistant em Docker**, com a stack para o Portainer.

### 🔧 Changed

- **Guia do Docker + Portainer** revisado.

## [2025.10.1] - 2025-10-29

### ✨ Added

- **🐳 Docker + Portainer no Debian** ([`docs/portainer-debian.md`](./docs/portainer-debian.md)), com os dados centralizados em `/srv`.
- **🖥️ RustDesk Headless no Debian** ([`docs/rustdesk-headless.md`](./docs/rustdesk-headless.md)).

### 🗑️ Removed

- **Guia de secure boot da Jade**, retirado deste repositório.

### 🐛 Fixed

- **Links quebrados** no guia do Portainer.

## [2025.8.1] - 2025-08-30

### ✨ Added

- **Guia de secure boot da Jade**, criado no fim de julho e refinado ao longo de agosto.

### 🔧 Changed

- **`.gitignore` e a pasta `assets/`**: o perfil do Tasker passou para lá.

## [2025.7.1] - 2025-07-22

### ✨ Added

- **💧 Bomba d'Água Automática** ([`docs/bomba-dagua.md`](./docs/bomba-dagua.md)) e **🚨 Sirene Ativada por Chamada** ([`docs/sirene-por-chamada.md`](./docs/sirene-por-chamada.md)), com o README de índice.
- **Perfil do Tasker** ([`assets/configs/tasker.xml`](./assets/configs/tasker.xml)).

> [!NOTE]
> Todas as versões até `2026.9.1` foram **reconstruídas a partir do histórico do git**: o repositório nunca teve tags nem campo de versão. Cada versão fecha no último commit da fase, e a data é a desse commit. Os links de comparação abaixo só funcionam depois que as tags existirem.

[Unreleased]: https://github.com/cateim/DIY/compare/v2026.10.1...HEAD
[2026.10.1]: https://github.com/cateim/DIY/compare/v2026.9.1...v2026.10.1
[2026.9.1]: https://github.com/cateim/DIY/compare/v2026.8.1...v2026.9.1
[2026.8.1]: https://github.com/cateim/DIY/compare/v2026.7.1...v2026.8.1
[2026.7.1]: https://github.com/cateim/DIY/compare/v2026.6.1...v2026.7.1
[2026.6.1]: https://github.com/cateim/DIY/compare/v2026.5.1...v2026.6.1
[2026.5.1]: https://github.com/cateim/DIY/compare/v2026.4.1...v2026.5.1
[2026.4.1]: https://github.com/cateim/DIY/compare/v2026.3.1...v2026.4.1
[2026.3.1]: https://github.com/cateim/DIY/compare/v2025.11.1...v2026.3.1
[2025.11.1]: https://github.com/cateim/DIY/compare/v2025.10.1...v2025.11.1
[2025.10.1]: https://github.com/cateim/DIY/compare/v2025.8.1...v2025.10.1
[2025.8.1]: https://github.com/cateim/DIY/compare/v2025.7.1...v2025.8.1
[2025.7.1]: https://github.com/cateim/DIY/releases/tag/v2025.7.1
