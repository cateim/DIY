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
| `bindings.lua` | `SUPER + E` abre o Nautilus. `SUPER + SHIFT + E` e `SUPER + SHIFT + C` abrem Gmail e Google Agenda no lugar do HEY. `SUPER + H` abre o histórico da área de transferência. `SUPER + SHIFT + S` tira print de uma região (era o Google Maps). `CTRL + SHIFT + F12` troca o monitor do VNC. `SUPER + CTRL + ↑/↓` move a janela para o monitor de cima ou de baixo. `ALT + TAB` abre o switcher com miniaturas (submap `cateim-switcher`), menos no Windows VM, onde o Alt+Tab vai para o Windows. |
| `hyprland.lua` | O Bitwarden (app e janela da extensão no Chrome) volta a aparecer em captura de tela, para aprovar login pelo VNC e pelo RustDesk. Efeito colateral: aparece também em compartilhamento de tela e gravação. |
| `input.lua` | Teclado `us` (intl) e `br`; rolagem natural só no touchpad. |
| `monitors.lua` | LG UltraWide 2560x1080@75 em cima (`0x0`) e a tela do notebook 2560x1440@120, escala 1,25, embaixo (`256x1080`); GDK scale 1. |

### 3.2 Shell do Omarchy (`~/.config/omarchy/`)

| Arquivo | O que muda |
| :--- | :--- |
| `shell.json` | Barra com a janela ativa à esquerda e o layout de teclado (`cateim.keyboard-layout`) e o Tailscale à direita. Bloqueio da tela em 30 min (era 5) e descanso de tela em 10 min (era 2,5). Liga o plugin `cateim.window-switcher`. |
| `shell.toml` | Fonte base 12. |
| `defaults/agent` | Agente padrão do Omarchy: `claude`. |
| `themed/chromium.theme.tpl` | Modelo de tema do Chromium trocado por `0,0,0`. |
| `plugins/cateim.keyboard-layout/` | Clone do `omarchy.keyboard-layout` que troca o layout em todos os teclados de uma vez (`hyprctl switchxkblayout all`). O notebook, o uinput do RustDesk e o teclado virtual do wayvnc tinham cada um o seu. |
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
| `~/.config/mise/config.toml` | Ferramentas globais do mise: claude, codex, gemini, gh e Node 26.13.0. |
| `~/.config/autostart/bitwarden.desktop` | O Bitwarden abre no login. |
| `~/.local/share/applications/sideswap.desktop` | Atalho do SideSwap (AppImage em `~/Applications`, baixado à mão). |

### 3.6 Acesso remoto e Drive

| Arquivo | O que muda |
| :--- | :--- |
| `~/.config/wayvnc/config` | Senha VNC clássica (o cliente da Cloudflare no navegador só aceita essa e só usa 8 caracteres), chave RSA para clientes nativos e teclado fixo em ABNT2. |
| `~/.config/systemd/user/wayvnc.service` | wayvnc só em `127.0.0.1:5900`, na tela do notebook. |
| `~/.local/bin/vnc-trocar-tela` | Troca o monitor que o wayvnc transmite (`CTRL + SHIFT + F12`). |
| `~/.local/bin/drive-sync.sh` e `~/.config/systemd/user/drive-sync.{service,timer}` | rclone bisync do `~/Drive` com o Google Drive a cada 15 minutos, só com o `/home` do Crucial montado. |

### 3.7 Sistema (`/etc`, com `install.sh --system`)

| Arquivo | O que muda |
| :--- | :--- |
| `/etc/limine-entry-tool.d/alienware-display.conf` | `i915.enable_psr=0 i915.enable_dc=0` na linha do kernel (PSR e estados DC do i915 desligados). |
| `/etc/systemd/system/cloudflared.service` | Túnel da Cloudflare lendo o token de `/etc/cloudflared/token`. O token fica fora do repositório. |
| `/etc/systemd/system/home-emergencia.service` | Se o `/home` do Crucial não montar, usa a pasta `/home` do próprio sistema para ainda dar para entrar. |
| `/etc/systemd/system/rustdesk.service.d/sessao.conf` | Aponta o serviço do RustDesk para a sessão Wayland e o D-Bus do usuário. |
| `/etc/udev/rules.d/*.rules` (7 arquivos) | Carteiras de hardware: Ledger (`20-hw1`), Coldcard (`51-coinkite`), Trezor, KeepKey, BitBox02 e Jade. |

---

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
npm install --global rea-agents          # REA, no Node do mise (docs/rea.md)
rea setup --client claude_code --yes     # MCP e skill do REA no Claude Code; acha o Ghidra em /opt/ghidra
```

O ESP-IDF 5.5.5 do Jade fica em `~/esp`, com um venv próprio, e não está no DIY.

---

## Parte 5: Passos manuais

Tudo o que não é arquivo do espelho, na ordem em que faz sentido numa reinstalação.

1. **Tailscale**: `omarchy install service tailscale`, login, depois `sudo tailscale set --hostname=alienware`. No painel do Tailscale, desligue a expiração da chave deste nó.
2. **Drive**: rode `~/.local/bin/drive-sync.sh` uma vez, sem argumento. Ele cria o remoto `gdrive` (o client OAuth próprio está no Bitwarden), escreve os filtros, faz a primeira rodada e liga o timer. O `rclone.conf` tem o token do Google e nunca entra no DIY.
3. **Cloudflare Tunnel**: grave o token do túnel em `/etc/cloudflared/token` (root, modo 600) e rode `sudo systemctl enable --now cloudflared`. No Cloudflare One, o hostname `remote.<<DOMAIN>>` aponta para `tcp://localhost:5900`, atrás do Cloudflare Access.
4. **wayvnc**: gere a chave RSA dos clientes nativos e ligue o serviço:

   ```bash
   ssh-keygen -m pem -f ~/.config/wayvnc/rsa_key.pem -t rsa -N ""
   systemctl --user enable --now wayvnc.service
   ```

5. **RustDesk**: `sudo systemctl enable --now rustdesk`. O ID e o servidor próprio seguem o [`rustdesk-server.md`](./rustdesk-server.md).
6. **NAS** (CIFS em `/mnt/nas/midia`): crie o arquivo de credenciais (root, modo 600) e a linha do `/etc/fstab`:

   ```
   //<NAS>/midia /mnt/nas/midia cifs credentials=<arquivo>,uid=1000,gid=1000,file_mode=0664,dir_mode=0775,iocharset=utf8,vers=3.1.1,_netdev,nofail,x-systemd.automount 0 0
   ```

7. **Desbloqueio do LUKS por SSH no boot** (só pelo cabo): preencha `BOOT_*` e `UNLOCK_ROOT_KEYS` no `private.env` e rode [`assets/omarchy/scripts/ssh-no-boot.sh`](../assets/omarchy/scripts/ssh-no-boot.sh). Ele tira um snapshot antes, instala os hooks, gera o initramfs e confere tudo. Se acusar falha, não reinicie.
8. **Portainer Agent**: siga o [`portainer-agent.md`](./portainer-agent.md).
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

---

## Parte 6: Mantendo o DIY em dia

Vale para toda personalização nova, mudada ou removida no notebook, na mesma sessão:

1. Mude o arquivo real no sistema, nunca o espelho.
2. Arquivo novo: uma linha no `files.txt`. Removeu: tire a linha.
3. Rode `assets/omarchy/export.sh`. Se ele acusar segredo, ponha o valor no `private.env` (e o nome em `PLACEHOLDER_KEYS` do `export.sh`, se for chave nova).
4. Atualize a tabela certa deste guia (Parte 3, 4 ou 5) e o `[Unreleased]` do [`CHANGELOG.md`](../CHANGELOG.md).
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
