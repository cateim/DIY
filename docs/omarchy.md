# 🐧 Omarchy no Alienware (personalizações e reinstalação)

Tudo o que foi mudado de propósito no Omarchy 4 do notebook Alienware 17 R3 (hostname `alienware`) desde a instalação em 31/10/2026, com os arquivos e os scripts para devolver cada mudança numa reinstalação do zero. O repositório é público: dados pessoais (domínio, e-mail, nomes dos servidores, endereço `.onion`) viram placeholders `<<NOME>>` e segredos nunca entram. Os valores reais ficam num `private.env` fora do git, com cópia no Bitwarden.

**Pré-requisito:** Omarchy 4 instalado ([omarchy.org](https://omarchy.org/)). Para o Docker deste notebook no Portainer central, veja [`portainer-agent.md`](./portainer-agent.md).

Os arquivos e os scripts estão em [`assets/omarchy/`](../assets/omarchy/).

> ℹ️ Este guia é também o inventário. Mudou ou removeu alguma personalização no notebook? O DIY é atualizado na mesma sessão, pelo roteiro da [Parte 6](#parte-6-mantendo-o-diy-em-dia).

---

## Parte 1: Como o espelho funciona

| Arquivo | Para que serve |
| :--- | :--- |
| [`files.txt`](../assets/omarchy/files.txt) | Lista do que é guardado. `~/...` vai para `home/`, `/...` vai para `system/`. É a única fonte dos dois scripts. |
| [`export.sh`](../assets/omarchy/export.sh) | Sistema → repositório. Refaz `home/` e `system/` do zero, troca os valores do `private.env` por `<<NOME>>` e o `$HOME` por `<<HOME>>`. Falha se sobrar senha, token, chave privada, IP do Tailscale ou da rede local, e-mail ou `.onion`. |
| [`install.sh`](../assets/omarchy/install.sh) | Repositório → sistema. Devolve os valores no lugar dos placeholders, faz backup `<arquivo>.bak.<epoch>` de cada arquivo diferente e pula os iguais. `--dry-run` só mostra; `--system` inclui o `/etc` (com sudo). |
| [`private.env.example`](../assets/omarchy/private.env.example) | Modelo do `~/.config/diy-omarchy/private.env` (chmod 600), que nunca vai para o git. |
| [`packages.txt`](../assets/omarchy/packages.txt), [`packages-aur.txt`](../assets/omarchy/packages-aur.txt), [`flatpak.txt`](../assets/omarchy/flatpak.txt) | O que foi instalado depois do Omarchy, levantado do `pacman.log`, do `pacman -Qqm` e do `flatpak history`. |
| [`scripts/ssh-no-boot.sh`](../assets/omarchy/scripts/ssh-no-boot.sh) | Desbloqueio do LUKS por SSH no boot ([Parte 5](#parte-5-passos-manuais)). |

Placeholders do espelho:

| Placeholder | Onde aparece |
| :--- | :--- |
| `<<HOME>>` | Caminhos absolutos da home (favoritos do Nautilus, units, scripts). |
| `<<DOMAIN>>` | `remote.<<DOMAIN>>` (VNC no navegador) e comentários. |
| `<<GIT_NAME>>`, `<<GIT_EMAIL>>` | `~/.gitconfig` e `~/.config/git/config`. |
| `<<FORGEJO_ONION>>` | Proxy Tor do Forgejo no `~/.gitconfig`. |
| `<<WAYVNC_PASSWORD>>` | `~/.config/wayvnc/config`, que o `install.sh` grava com modo 600. |
| `<<CHROMIUM_OAUTH_CLIENT_ID>>`, `<<CHROMIUM_OAUTH_CLIENT_SECRET>>` | `~/.config/chromium-flags.conf` (sync do Google no Chromium). |
| `<<VPS_NAME>>`, `<<HOMELAB_NAME>>` | Nomes dos servidores nos comentários do `starship.toml` e do `eza/theme.yml`. |

> ⚠️ O `export.sh` apaga e refaz `assets/omarchy/home/` e `assets/omarchy/system/` a cada rodada. Nunca edite os arquivos de lá: edite o arquivo real no sistema e rode o export.

---

## Parte 2: Reinstalação do zero

1. **Omarchy 4** pela ISO. Sistema com LUKS no Samsung e `/home` no Crucial (LUKS2 + btrfs, destravado por keyfile em `/etc/cryptsetup-keys.d/`). Os scripts de disco da migração ainda não estão no DIY (veja [Notas Importantes](#notas-importantes)).
2. **DIY numa pasta temporária**, porque o `~/Drive` só volta depois do drive-sync (Parte 5):

   ```bash
   git clone https://github.com/cateim/DIY.git /tmp/DIY && cd /tmp/DIY
   ```

3. **Pacotes** (uns 20 minutos):

   ```bash
   omarchy pkg add $(grep -vE '^\s*(#|$)' assets/omarchy/packages.txt | cut -d' ' -f1)
   omarchy pkg aur add $(grep -vE '^\s*(#|$)' assets/omarchy/packages-aur.txt | cut -d' ' -f1)
   flatpak install -y flathub $(grep -vE '^\s*(#|$)' assets/omarchy/flatpak.txt | cut -d' ' -f1)
   omarchy pkg drop ghostty ghostty-shell-integration ghostty-terminfo
   ```

   Tailscale e Voxtype têm passo próprio na [Parte 5](#parte-5-passos-manuais).

4. **private.env**: copie a nota "DIY Omarchy private.env" do Bitwarden para `~/.config/diy-omarchy/private.env` e rode `chmod 600` nele.
5. **Arquivos** (uns 2 minutos):

   ```bash
   assets/omarchy/install.sh --system --dry-run   # confira a lista
   assets/omarchy/install.sh --system
   ```

6. **Recarregar** com os comandos que o `install.sh` imprime no fim: `hyprctl reload`, `omarchy restart shell`, as units do usuário, `udevadm` e `limine-mkinitcpio`.
7. **Passos manuais** da [Parte 5](#parte-5-passos-manuais).

---

## Parte 3: Inventário dos arquivos

### 3.1 Hyprland (`~/.config/hypr/`)

| Arquivo | O que muda |
| :--- | :--- |
| `bindings.lua` | `SUPER + E` abre o Nautilus. `SUPER + SHIFT + E` e `SUPER + SHIFT + C` abrem Gmail e Google Agenda no lugar do HEY. `SUPER + H` abre o histórico da área de transferência. `SUPER + SHIFT + S` tira print de uma região (era o Google Maps). `CTRL + SHIFT + F12` troca o monitor do VNC. `SUPER + CTRL + ↑/↓` move a janela para o monitor de cima ou de baixo. `SUPER + SHIFT + J` iguala as janelas do workspace (veja `igualar-janelas.lua`). `ALT + TAB` abre o switcher com miniaturas (submap `cateim-switcher`), menos no Windows VM, onde o Alt+Tab vai para o Windows. Desde a migração do Omarchy 4.5, `SUPER + CTRL + X` e `F9` (segurando) ligam o ditado do voxtype; a 4.5 também liga `ALT + ESPAÇO` e o Alt direito, que no `us intl` e no `br` é AltGr e não dispara o atalho. |
| `igualar-janelas.lua` | Módulo do `SUPER + SHIFT + J`: no layout tiling (dwindle), deixa as colunas com a mesma largura e as linhas com a mesma altura. O dwindle não tem comando para isso, e 3 janelas lado a lado ficam em 50/25/25. O Hyprland não mostra a árvore do dwindle, então o módulo descobre o pai de cada janela mexendo no `splitratio` (só vale para o pai da janela com foco) e acerta cada divisão pelo número de colunas ou linhas de cada lado. Tudo roda numa chamada Lua só, sem quadro intermediário; o foco, o cursor e a ordem do Alt+Tab entre as janelas voltam como estavam. Limite: uma divisão com grupos de janelas dos dois lados não tem janela filha direta e fica como está, com notificação. Em workspace scrolling ou com tela cheia, só avisa. |
| `hyprland.lua` | O Bitwarden (app e janela da extensão no Chrome) volta a aparecer em captura de tela, para aprovar login pelo VNC e pelo RustDesk. Efeito colateral: aparece também em compartilhamento de tela e gravação. |
| `input.lua` | Teclado `us` (intl) e `br`; rolagem natural só no touchpad. |
| `monitors.lua` | Tela do notebook 2560x1440@120, escala 1,25, na origem (`0x0`), e o LG UltraWide 2560x1080@75 em cima, centralizado (`-256x-1080`). O LG tem duas regras iguais, pela descrição e pela porta `HDMI-A-4`: desde o Omarchy 4.5 o painel Display religa a tela pelo nome e mantém modo e posição da regra com esse nome; só com a regra pela descrição o LG voltava à direita, a 60 Hz. `omarchy_gdk_scale` e `omarchy_monitor_scale` são do controle de escala do Omarchy e só valem para o `GDK_SCALE` e para tela sem regra própria; ficam em 1, porque desde a 4.5 o `GDK_SCALE` segue a menor escala arredondada (com 2, os apps GTK do XWayland abriam com o dobro do tamanho). O notebook fica em `0x0` por causa do RustDesk: o `xdg-desktop-portal-hyprland` informa toda tela compartilhada em `(0,0)`, e com o notebook em outra posição o mouse remoto caía no LG. Numa sessão do RustDesk o LG fica desligado (veja `rustdesk-tela-unica` na Parte 3.6). |

### 3.2 Shell do Omarchy (`~/.config/omarchy/`)

| Arquivo | O que muda |
| :--- | :--- |
| `shell.json` | Barra com a janela ativa à esquerda e o layout de teclado (`omarchy.keyboard-layout`, o original desde a 4.5) e o Tailscale à direita. Bloqueio da tela em 30 min (era 5) e descanso de tela em 10 min (era 2,5). Liga o plugin `cateim.window-switcher`. Desde a 4.5 o centro da barra tem `centerBegin` (indicadores), o relógio e `centerEnd` (Elsewhen, clima e atualizações). Barra transparente (`transparent: true`, escolhido em 05/11/2026). O Elsewhen mostra São Paulo, Londres, Dubai, Tóquio e Los Angeles em 24 h (o padrão é Los Angeles, Paris e Tóquio). O dock fixa só Nautilus, foot, omacalc e omawrite (o padrão também fixa chromium, X e YouTube); o próprio dock grava essa lista quando se desafixa um app, e reescreve o arquivo com as chaves em ordem alfabética. |
| `shell.toml` | Fonte base 12. |
| `defaults/agent` | Agente padrão do Omarchy: `claude`. |
| `themed/chromium.theme.tpl` | Modelo de tema do Chromium trocado por `0,0,0`. |
| `plugins/cateim.window-switcher/` | Alt+Tab com miniaturas ao vivo, na ordem de uso, no monitor focado. Mudança no QML só vale depois de `omarchy restart shell`. |

### 3.3 Terminal e prompt

| Arquivo | O que muda |
| :--- | :--- |
| `~/.bashrc` | Carrega o ble.sh (sugestões do histórico e cores), põe cor no `grep`, `diff` e `ip`, e a função `claude` abre o Claude Code em `~/Work` quando chamada da home. |
| `~/.config/starship.toml` | Prompt no mesmo formato do homelab: memória, tempo do comando, versões das linguagens, venv, jobs e status. |
| `~/.config/kitty/kitty.conf` | Fonte 9. |
| `~/.config/blesh/init.sh` | Cores do ble.sh. |
| `~/.config/eza/theme.yml` | Cores fixas por tipo de arquivo, legíveis em qualquer tema do Omarchy. |

### 3.4 Git

| Arquivo | O que muda |
| :--- | :--- |
| `~/.gitconfig` | Git LFS, branch `master`, autostash, rebase no pull, `autocrlf=input`, editor `nvim`, credenciais no libsecret e no `gh`, e o proxy Tor `socks5h://127.0.0.1:9150` só para o Forgejo `.onion`. |
| `~/.config/git/config` | O modelo do Omarchy mais nome, e-mail e o `gh` como credencial do GitHub. |

> ℹ️ As linhas `credential` do `gh` levam o caminho da versão instalada pelo mise. Depois de `gh auth login`, rode `gh auth setup-git` para elas apontarem para a versão nova.

### 3.5 Navegadores, apps e pastas

| Arquivo | O que muda |
| :--- | :--- |
| `~/.config/chromium-flags.conf` | Flags do Omarchy mais o client OAuth do projeto Chromium, que liga o sync do Google. |
| `~/.config/chrome-flags.conf` | Wayland, senhas no libsecret e as extensões do Omarchy no Google Chrome. |
| `~/.config/antigravity-ide-flags.conf` | Senhas do Antigravity no libsecret. |
| `~/.config/mimeapps.list` | Apps padrão, sem o HEY no `mailto`. |
| `~/.config/user-dirs.dirs` | Área de trabalho, Modelos e Público apontam para a home, para não criar pastas vazias. |
| `~/.config/gtk-3.0/bookmarks` | Favoritos do Nautilus: Drive, GitHub, Documentos, NAS e o backup do Windows. |
| `~/.config/mise/config.toml` | Só `[settings.upgrade]` desde a migração do Omarchy 4.5: claude, codex, gh e o Node vêm de `/etc/mise/conf.d/omarchy-tools.toml`, do Omarchy. O gemini segue no PATH. |
| `~/.config/autostart/bitwarden.desktop` | O Bitwarden abre no login. |
| `~/.local/share/applications/sideswap.desktop` | Atalho do SideSwap (AppImage em `~/Applications`, baixado à mão). |
| `~/.local/bin/icones-pastas` | Ícone próprio de cada pasta de `~/Drive/GitHub` no Nautilus. O ícone de uma pasta é o arquivo com o mesmo nome em `~/.local/share/icons/pastas/` (`tasmota-ir.png` vale para a pasta `tasmota-ir`), e o script grava o `metadata::custom-icon` do gvfs a partir deles. O Nautilus só relê um ícone trocado no mesmo caminho depois de `nautilus -q`; fechar a janela não basta, porque o processo continua aberto. A pasta dos ícones fica fora do espelho por decisão, porque tem logos e nomes de projetos de cliente; a cópia dela fica no Drive (veja a Parte 5). |

### 3.6 Acesso remoto e Drive

| Arquivo | O que muda |
| :--- | :--- |
| `~/.config/wayvnc/config` | Senha VNC clássica (o cliente da Cloudflare no navegador só aceita essa e só usa 8 caracteres), chave RSA para clientes nativos e teclado no layout `brvnc` (ABNT2 com CapsLock agindo como SUPER). |
| `~/.config/xkb/symbols/brvnc` | Layout só do teclado virtual do wayvnc: ABNT2 em que o CapsLock mantém o keysym `Caps_Lock` mas age como SUPER. No navegador do Windows a tecla Win fica com o sistema e o CapsLock chega, então os atalhos SUPER do Hyprland funcionam pelo VNC da Cloudflare. O teclado físico do notebook não muda. |
| `~/.config/systemd/user/wayvnc.service` | wayvnc só em `127.0.0.1:5900`, na tela do notebook. |
| `~/.local/bin/vnc-trocar-tela` | Troca o monitor que o wayvnc transmite (`CTRL + SHIFT + F12`). |
| `~/.local/bin/rustdesk-tela-unica` e `~/.config/systemd/user/rustdesk-tela-unica.service` | Desliga o LG enquanto houver sessão do RustDesk e religa com `hyprctl reload` quando a última fecha (o processo `rustdesk --cm` some). Com duas telas no Wayland, o servidor do RustDesk 1.5.1 espera o mouse em coordenada lógica (escala 1,25) e o cliente web (CortenDesk) manda a física, então o cursor errava cada vez mais para o canto de baixo à direita. O desligar sai do log do servidor (`tail -F` no `rustdesk_rCURRENT.log`, linha `create_relay requested` ou `Connection opened`), uns 400 ms antes de o servidor guardar o arranjo de telas da sessão: se o LG só sumisse depois, o servidor converteria o mouse do arranjo antigo para o novo e o erro voltaria até a captura reiniciar. Pedido sem sessão em 90 s religa o LG. Se o mouse errar mesmo assim, o **Refresh video** do CortenDesk reinicia a captura e acerta. As janelas do LG passam para outra área de trabalho do notebook durante a sessão. Ao desligar o LG, uma notificação diz o IP da conexão (uma sessão esquecida aberta não fica invisível). Ligar o LG à mão pelo painel depois dos primeiros 20 s da sessão vale até ela fechar, e o mouse do cliente web pode errar nesse tempo; antes disso o serviço insiste, porque no começo da sessão o LG às vezes religa sozinho. Com alguém no VNC, o fim da sessão não religa o LG: fica a marca `$XDG_RUNTIME_DIR/lg-religar-depois-do-vnc`, e o `vnc-sessao` religa quando o último cliente do VNC sair. O fim da sessão é visto procurando o `rustdesk --cm` só nos processos do `rustdesk.service` (`/sys/fs/cgroup/system.slice/rustdesk.service/cgroup.procs`): o `pgrep` no notebook inteiro custava uns 100 ms a cada 2 s, e a linha de comando dele fazia o `rustdesk --service` reiniciar o `--server` a cada minuto (veja o Troubleshooting). |
| `~/.local/bin/vnc-sessao` e `~/.config/systemd/user/vnc-sessao.service` | Enquanto houver alguém no VNC, o protetor de tela não abre e o LG fica desligado. Parado 10 minutos, o protetor animado fazia o wayvnc mandar de 6,5 a 9,6 Mbps pelo túnel sem ninguém mexendo; o serviço liga o interruptor do próprio Omarchy (`omarchy-toggle screensaver-off`, o mesmo do menu) e só o desliga no fim se foi ele que ligou (marca em `~/.local/state/vnc-sessao/`). O bloqueio dos 30 minutos continua valendo. O wayvnc só transmite o eDP-1, então com o LG ligado a área de trabalho dele sumia de quem está no VNC; desligado, as janelas vêm para o notebook (o `vnc-trocar-tela` fica só com o notebook). Ao desligar, uma notificação avisa quem está na frente do notebook. Lê os eventos do `wayvncctl --json event-receive`; religa com `hyprctl reload` quando o último cliente sai, a não ser que o LG já estivesse desligado à mão ou que haja sessão do RustDesk aberta (aí religa o `rustdesk-tela-unica`). Ligar o LG à mão depois dos primeiros 20 s vale até o VNC sair. |
| `~/.local/bin/drive-sync.sh` e `~/.config/systemd/user/drive-sync.{service,timer}` | rclone bisync do `~/Drive` com o Google Drive a cada 15 minutos, só com o `/home` do Crucial montado. As listagens do bisync ficam em `~/.local/state/rclone/bisync`, fora do `~/.cache` (o padrão do rclone): apagar o cache para liberar espaço não para mais a sincronização. Toda rodada termina no `~/.local/bin/drive-sync-aviso` (`ExecStopPost`): se falhou, aparece uma notificação crítica com a causa, repetida a cada hora enquanto continuar falhando; quando volta, outra avisa. Rodada travada vira falha em 2 h (`TimeoutStartSec`). O `resync` aceita o `~/Drive` em uso: roda sem a conferência final do rclone (`--check-sync=false`), compara as duas listagens no fim, marca com `touch` o que mudou no notebook durante a rodada base, pergunta arquivo por arquivo o que mudou na nuvem e fecha com uma rodada normal, que volta a conferir. Ele também pausa o timer, senão a rodada dele bate no lock e vira alarme falso, e deixa em `~/.local/state/drive-sync/pausado` o próprio pid. O `drive-sync-vigia.{service,timer}` (`drive-sync-aviso --vigia`, a cada hora) cobre o que o aviso da rodada não vê, porque aí nenhuma rodada acontece: timer desligado, timer fora do boot e unit que não carrega. Durante o `resync` ele respeita a pausa enquanto o pid da marca for de um `drive-sync.sh` vivo. |

### 3.7 Sistema (`/etc`, com `install.sh --system`)

| Arquivo | O que muda |
| :--- | :--- |
| `/etc/limine-entry-tool.d/alienware-display.conf` | `i915.enable_psr=0 i915.enable_dc=0` na linha do kernel (PSR e estados DC do i915 desligados). |
| `/etc/systemd/system/cloudflared.service` | Túnel da Cloudflare lendo o token de `/etc/cloudflared/token`. O token fica fora do repositório. |
| `/etc/systemd/system/home-emergencia.service` | Se o `/home` do Crucial não montar, usa a pasta `/home` do próprio sistema para ainda dar para entrar. |
| `/etc/systemd/system/rustdesk.service.d/sessao.conf` | Aponta o serviço do RustDesk para a sessão Wayland e o D-Bus do usuário. |
| `/etc/udev/rules.d/*.rules` (7 arquivos) | Carteiras de hardware: Ledger (`20-hw1`), Coldcard (`51-coinkite`), Trezor, KeepKey, BitBox02 e Jade. |

---

### 3.8 Vigia das atualizações do Omarchy

| Arquivo | O que muda |
| :--- | :--- |
| `~/.local/bin/vigia-omarchy` | Guarda uma cópia dos arquivos do Omarchy de que as personalizações dependem e a versão dos pacotes que importam (`~/.local/state/vigia-omarchy/base/`). A cada execução compara, grava o que mudou com o diff em `~/.local/state/vigia-omarchy/relatorio.txt` e manda uma notificação; também acusa erro na config do Hyprland, atalho repetido, plugin `cateim.*` desligado e o shell do Omarchy ainda rodando o código de antes da atualização. Depois de revisar o relatório: `vigia-omarchy aceitar`. A base não vai para o DIY: numa máquina nova a primeira execução grava a base sem avisar. Nasceu na 4.5, que deixou o clone do keyboard-layout para trás e mudou o religar do painel Display sem aviso nenhum. |
| `~/.config/vigia-omarchy/vigiados.conf` | O que vigiar, uma linha por item (`arquivo` ou `pacote`, o alvo e a personalização afetada): painel Display, lançador do protetor de tela e serviço de ociosidade do shell (de que o `vnc-sessao` depende), peças do shell que o window-switcher usa, tema do Chromium, modelos de onde saíram os arquivos do `~/.config`, o `omarchy-tools.toml` do mise, o `omarchy-notification-dismiss` (o `drive-sync-aviso` tira o aviso da tela por ele), a unit do RustDesk e os pacotes rustdesk, hyprland, xdg-desktop-portal-hyprland, quickshell, wayvnc, rclone e nautilus (ícones das pastas). |
| `~/.config/omarchy/hooks/post-update.d/vigia-omarchy` e `post-boot.d/vigia-omarchy` | Rodam o vigia dentro do `omarchy update`, depois das migrações, e a cada início da sessão, que pega o que mudou fora do update ou depois do hook (AUR e mise). |

## Parte 4: Pacotes

As três listas ficam em [`assets/omarchy/`](../assets/omarchy/) e se instalam pela [Parte 2](#parte-2-reinstalação-do-zero). Ficaram de fora das listas, cada um com passo próprio: `tailscale`, `voxtype-bin` e os `mkinitcpio-netconf/tinyssh/utils` (instalados pelo `ssh-no-boot.sh`).

**Removidos de propósito** (não reinstalar):

| O quê | Quando | Por quê |
| :--- | :--- | :--- |
| `ghostty`, `ghostty-shell-integration`, `ghostty-terminfo` | 01/11/2026 | Removidos à mão; o motivo não foi registrado. |
| `libratbag`, `piper` | 03/11/2026 | Usados para gravar o perfil do G903 (Parte 5) e removidos em seguida. |
| Bambu Studio (flatpak `com.bambulab.BambuStudio`) | 03/11/2026 | A pedido do Gustavo: não deve ser usado neste notebook. |
| Webapp HEY | 02/11/2026 | Gmail e Google Agenda no lugar (atalhos da Parte 3.1). |

**Não entram no espelho**, porque o próprio Omarchy gera: os wrappers dos agentes em `~/.local/bin` (`claude`, `codex`, `gemini`...), o serviço e a config do Voxtype, os hooks e as amostras de `~/.config/omarchy/hooks/` e os webapps padrão.

**Ambiente de desenvolvimento**, fora das listas:

```bash
uv tool install graphifyy
uv tool install semgrep
uv tool install clang-format
uv tool install unblob==26.6.4 --with-executables-from jefferson,ubi-reader   # extração de firmware do REA (docs/rea.md, Parte 6)
npm install --global rea-agents          # REA, no Node do mise (docs/rea.md)
rea setup --client claude_code --yes     # MCP e skill do REA no Claude Code; acha o Ghidra em /opt/ghidra
```

Os motores do REA que não vêm do pacman (Kuna, Wakaru e o JAR do JADX, em `~/.local/share/rea`, e o Unblob acima) e as variáveis `REA_*` do registro estão na [Parte 6 do guia do REA](./rea.md#parte-6-motores-opcionais-instalar-quando-a-tarefa-pedir).

O ESP-IDF 5.5.5 do Jade fica em `~/esp`, com um venv próprio, e não está no DIY.

O Rust vem do pacote `rustup` da lista, com os toolchains em `~/.rustup`. Não rode o `omarchy install dev-env rust` (no menu, Install > Development > Rust): ele baixa o instalador oficial, que põe um segundo `rustup` em `~/.cargo/bin`, na frente do pacman, e acrescenta o `~/.cargo/env` no `.bashrc` depois do `ble-attach`, no `.profile` e no `.bash_profile`. Se rodar por engano, apague o `~/.cargo` e o `~/.profile` que ele criou e tire a linha dos outros dois. O `omarchy remove dev-env rust` não serve, porque roda o `rustup self uninstall`, que apaga também o `~/.rustup` do rustup do pacman.

---

## Parte 5: Passos manuais

Tudo o que não é arquivo do espelho, na ordem em que faz sentido numa reinstalação.

1. **Tailscale**: `omarchy install service tailscale`, login, depois `sudo tailscale set --hostname=alienware`. No painel do Tailscale, desligue a expiração da chave deste nó.
2. **Drive**: rode `~/.local/bin/drive-sync.sh` uma vez, sem argumento. Ele cria o remoto `gdrive` (o client OAuth próprio está no Bitwarden), escreve os filtros, faz a primeira rodada e liga os dois timers, o do drive-sync e o do vigia. O `rclone.conf` tem o token do Google e nunca entra no DIY. Daí em diante, rodada que falha aparece como notificação crítica, com a causa, e o vigia avisa se o timer parar (veja `drive-sync-aviso` na 3.5).
3. **Cloudflare Tunnel**: grave o token do túnel em `/etc/cloudflared/token` (root, modo 600) e rode `sudo systemctl enable --now cloudflared`. No Cloudflare One, o hostname `remote.<<DOMAIN>>` aponta para `tcp://localhost:5900`, atrás do Cloudflare Access.
4. **wayvnc**: gere a chave RSA dos clientes nativos e ligue o serviço:

   ```bash
   ssh-keygen -m pem -f ~/.config/wayvnc/rsa_key.pem -t rsa -N ""
   systemctl --user enable --now wayvnc.service vnc-sessao.service
   ```

5. **RustDesk**: `sudo systemctl enable --now rustdesk` e `systemctl --user enable --now rustdesk-tela-unica.service`. O ID e o servidor próprio seguem o [`rustdesk-server.md`](./rustdesk-server.md).
6. **NAS** (CIFS em `/mnt/nas/midia`): crie o arquivo de credenciais (root, modo 600) e a linha do `/etc/fstab`:

   ```
   //<NAS>/midia /mnt/nas/midia cifs credentials=<arquivo>,uid=1000,gid=1000,file_mode=0664,dir_mode=0775,iocharset=utf8,vers=3.1.1,_netdev,nofail,x-systemd.automount 0 0
   ```

7. **Desbloqueio do LUKS por SSH no boot** (só pelo cabo): preencha `BOOT_*` e `UNLOCK_ROOT_KEYS` no `private.env` e rode [`assets/omarchy/scripts/ssh-no-boot.sh`](../assets/omarchy/scripts/ssh-no-boot.sh). Ele tira um snapshot antes, instala os hooks, gera o initramfs e confere tudo. Se acusar falha, não reinicie.
8. **Portainer Agent**: `sudo systemctl enable docker.service` primeiro. O Omarchy liga só o `docker.socket`, e sem isso o Docker e o agent só sobem no primeiro uso do Docker, não no boot. Depois siga o [`portainer-agent.md`](./portainer-agent.md).
9. **Voxtype**: aceite o convite "Install Dictation with Voxtype" do Omarchy.
10. **Luz do G903** (perfil gravado na memória do mouse):

    ```bash
    omarchy pkg add libratbag && sudo systemctl start ratbagd
    ratbagctl list                     # nome do mouse, ex.: warbling-mara
    ratbagctl <mouse> profile 0 led 0 set mode cycle duration 8000 brightness 255
    ratbagctl <mouse> profile 0 led 1 set mode cycle duration 8000 brightness 255
    omarchy pkg drop piper libratbag
    ```

11. **Apps**: os PWAs do Chrome voltam pelo sync da conta Google; o SideSwap é um AppImage baixado em `~/Applications/SideSwap.AppImage`.
12. **Agente SSH** (a senha de uma chave é pedida uma vez por login, não a cada `ssh`): ligue o agente do pacote `openssh` e ponha o bloco abaixo no fim do `~/.ssh/config`. O `IdentityAgent` faz o agente valer também para quem não herdou o `SSH_AUTH_SOCK`, como o Antigravity e o Claude Code. O `~/.ssh/config` fica fora do espelho, porque lista os servidores dos clientes.

    ```bash
    systemctl --user enable --now ssh-agent.socket
    ```

    ```text
    Host *
        AddKeysToAgent yes
        IdentityAgent ${XDG_RUNTIME_DIR}/ssh-agent.socket
    ```

    O primeiro `ssh` depois do login pede a senha e deixa a chave no agente até reiniciar ou sair da sessão. Para ver o que está carregado: `SSH_AUTH_SOCK=$XDG_RUNTIME_DIR/ssh-agent.socket ssh-add -l`.

13. **Ícones das pastas** (depois do `~/Drive`, passo 2): a cópia de `~/.local/share/icons/pastas/` fica no Google Drive, em `~/Drive/Omarchy/icones-pastas/`, e volta junto com o `~/Drive`. Copie de volta e rode:

    ```bash
    mkdir -p ~/.local/share/icons/pastas
    cp -a ~/Drive/Omarchy/icones-pastas/. ~/.local/share/icons/pastas/
    icones-pastas && nautilus -q
    ```

    A pasta dos ícones não está no DIY porque tem logos e nomes de projetos de cliente, e por isso a cópia fica no Drive, que é privado. Ícone novo ou trocado vai para as duas pastas. O metadata do gvfs (`~/.local/share/gvfs-metadata/`) também fica de fora: é binário e guarda o estado de todos os arquivos, não só o dos ícones.

---

## Parte 6: Mantendo o DIY em dia

Vale para toda personalização nova, mudada ou removida no notebook, na mesma sessão:

1. Mude o arquivo real no sistema, nunca o espelho.
2. Arquivo novo: uma linha no `files.txt`. Removeu: tire a linha.
3. Rode `assets/omarchy/export.sh`. Se ele acusar segredo, ponha o valor no `private.env` (e o nome em `PLACEHOLDER_KEYS` do `export.sh`, se for chave nova).
4. Atualize a tabela certa deste guia (Parte 3, 4 ou 5) e o `[Unreleased]` do [`CHANGELOG.md`](../CHANGELOG.md).
   Se a personalização copia algo do Omarchy ou depende de um comportamento dele, ponha uma linha no `~/.config/vigia-omarchy/vigiados.conf` e rode `vigia-omarchy` uma vez.
5. Valor novo no `private.env`: atualize a nota do Bitwarden.
6. Commit com escopo `omarchy`, por exemplo `docs(omarchy): add the window switcher plugin`.

---

## Troubleshooting

| Sintoma | Causa | Correção |
| :--- | :--- | :--- |
| `export.sh: possível segredo ou dado pessoal` | Valor pessoal ou segredo sem placeholder | Ponha o valor no `private.env` (e em `PLACEHOLDER_KEYS`) ou tire o arquivo do `files.txt`. |
| `export.sh: falta .../private.env` | Primeira vez ou máquina nova | Copie a nota do Bitwarden ou parta do `private.env.example`. |
| `install.sh` lista arquivos "Ainda com <<NOME>>" | Falta valor no `private.env` | Preencha e rode o `install.sh` de novo; os arquivos iguais são pulados. |
| Plugin do shell não muda depois do install | Plugin `keepLoaded` e o cache de componente do QML | `omarchy restart shell`. |
| Alt+Tab não confirma ao soltar o Alt | Bind de soltar sem `submap_universal` ou `transparent` | Veja o comentário do bloco no `bindings.lua` (Hyprland 0.56.2, `KeybindManager.cpp:652` e `:867`). |
| Teclado preso no switcher | Submap `cateim-switcher` ativo | `hyprctl dispatch 'hl.dsp.submap("reset")'`. |
| Depois de um `omarchy update`, `SUPER + SPACE` ou `SUPER + ALT + SPACE` não faz nada (`omarchy-shell omarchy.dock apps` responde `Target not found`) | O shell do Omarchy não foi reiniciado e roda o código antigo, que não tem o que os atalhos novos chamam | `omarchy restart shell`. O `vigia-omarchy` avisa ("SHELL ANTIGO"). Desde a 4.5, `SUPER + SPACE` abre o menu do Omarchy e `SUPER + ALT + SPACE` os apps. |
| Um log novo por minuto em `~/.local/share/logs/RustDesk/server/` (o `--server` reinicia sem sessão) | Algum processo tem na linha de comando o caminho do RustDesk seguido de `--cm`, como um `pgrep -f` com esse texto: o `rustdesk --service` o toma por uma sessão e reinicia o `--server` quando ele some (`get_cm`, `linux.rs:1312`) | Ache o processo pela linha de comando, com o padrão `rustdes[k] --cm` para o próprio comando não entrar na conta. Em script, use esse padrão no `pgrep -f`. Sem sessão, o normal é 1 reinício por hora. |
| LG não volta pelo painel Display | Sessão do RustDesk aberta (o CortenDesk reconecta sozinho depois de um `Timeout`) | A notificação do `rustdesk-tela-unica` diz o IP. Feche a sessão na janela do RustDesk ou ligue o LG de novo depois de 20 s. |
| LG não volta depois do VNC | O `vnc-sessao` espera o RustDesk fechar, ou o LG estava desligado à mão antes de o VNC conectar | `journalctl --user -u vnc-sessao -u rustdesk-tela-unica`. Para religar já: `hyprctl reload`. |
| Protetor de tela não abre mais | Interruptor `screensaver-off` ligado pelo `vnc-sessao` e não devolvido (marca em `~/.local/state/vnc-sessao/`) | O serviço devolve ao subir sem ninguém no VNC: `systemctl --user restart vnc-sessao`. À mão: `omarchy-toggle screensaver-off off`. |
| LG volta à direita, a 60 Hz | Regra `HDMI-A-4` fora do `monitors.lua`, ou o painel Display mudou | `hyprctl reload` e veja o relatório do `vigia-omarchy`. |
| Git pede senha do GitHub | Caminho velho do `gh` nas linhas `credential` | `gh auth setup-git`. |

---

## Notas Importantes

- O repositório é público. Senha, token, chave e o `.onion` ficam só no `private.env`, com cópia no Bitwarden; o `export.sh` se recusa a terminar se achar um deles no espelho.
- Os scripts de disco da migração (formatação do Crucial, cópia do NAS) estão em `~/Documents/Migracao-Omarchy`, ainda fora do DIY: formatam disco e precisam de revisão antes de virar guia.
- Estado de app (perfis do navegador, Antigravity, Bitwarden, Telegram) não entra no espelho: volta pelo login ou pelo sync de cada app.
- O `~/.claude` (Claude Code) fica fora deste guia por decisão: tem conteúdo pessoal e outro ciclo de vida.

---

## Acessos

| Serviço | Endereço |
| :--- | :--- |
| VNC no navegador | `https://remote.<<DOMAIN>>` (Cloudflare Access + senha do wayvnc) |
| RustDesk | Servidor próprio ([`rustdesk-server.md`](./rustdesk-server.md)) |
| Desbloqueio do LUKS no boot | `ssh root@<BOOT_IP>`, só pelo cabo |
| Portainer Agent | Porta 9001, só pelo Tailscale ([`portainer-agent.md`](./portainer-agent.md)) |

---

## Referências

- [Omarchy](https://omarchy.org/)
- [Hyprland: binds](https://wiki.hypr.land/configuring/core/binds/) e [submaps](https://wiki.hypr.land/configuring/core/binds/submaps/)
- [wayvnc (README)](https://github.com/any1/wayvnc)
- [rclone bisync](https://rclone.org/bisync/)
- [Arch Wiki: desbloqueio remoto do dm-crypt](https://wiki.archlinux.org/title/Dm-crypt/Specialties#Remote_unlocking_of_root_(or_other)_partition)
