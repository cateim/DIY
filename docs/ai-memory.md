# 🧠 Setup do AI-Memory (AkitaOnRails)

Este documento detalha a instalação do [ai-memory](https://github.com/akitaonrails/ai-memory) em uma arquitetura dividida:

1. **O Cérebro (Servidor):** Container Docker rodando no Orange Pi (Linux/Portainer).
2. **O Espião (Cliente):** CLI nativo em Rust rodando no Windows interceptando o Claude Code via Antigravity IDE.

## 🏗️ 1. O Cérebro (Orange Pi / Servidor)

O backend é responsável pelo banco vetorial, consolidação de memórias e comunicação com a API do Gemini.

### Preparação do Host

Crie o diretório de dados e ajuste a permissão para o usuário interno do container (UID 1000):

```bash
sudo mkdir -p /srv/ai-memory/data
sudo chown -R 1000:1000 /srv/ai-memory/data
```

### Imagem (Docker Hub)

Usamos a imagem **oficial** publicada pelo Akita no Docker Hub: [`akitaonrails/ai-memory`](https://hub.docker.com/r/akitaonrails/ai-memory). Ela é **multi-arch** (`linux/amd64` + `linux/arm64`), então roda **nativamente no Orange Pi 5** (RK3588 / ARM64) — sem emulação e **sem precisar compilar a imagem localmente**.

> ⚠️ **Lição aprendida:** a versão anterior desta stack usava uma imagem `ai-memory:local` (buildada no próprio Orange Pi). Como o nome era local, o **Redeploy do Portainer nunca puxava nada novo** — só reusava o cache. Migrando para `akitaonrails/ai-memory:latest`, o update passa a ser um `pull` da imagem oficial (veja a seção [Atualização](#-4-atualização-update)).

### Stack no Portainer (docker-compose.yml)

Crie uma nova Stack no Portainer chamada `ai-memory`:

1. Acesse o Portainer → **Stacks** → **Add Stack**
2. **Nome:** `ai-memory`
3. Cole o conteúdo do arquivo [`assets/stacks/ai-memory.yml`](../assets/stacks/ai-memory.yml) no Editor Web.
4. Clique em **Deploy the stack**.

_Nota: No YAML, troque `192.168.x.x` (em `AI_MEMORY_ALLOWED_HOSTS`) pelo IP real do Orange Pi na sua LAN. Esse `AI_MEMORY_ALLOWED_HOSTS` protege contra DNS rebinding em binds que não são loopback._

_Nota: `AI_MEMORY_INGEST__RECORD_TOOL_NAMES=true` faz o servidor gravar o nome de cada ferramenta na observação: `tool unknown: ToolSearch` em vez de só `tool unknown`, e nas chamadas de `Skill` e `Agent` do Claude Code também a skill ou o tipo de subagente. Só entram identificadores, nunca os argumentos (comando, prompt, caminho). Sem ela, as ferramentas fora do MCP chegam sem nome. Vale só para as observações novas._

**Environment Variables no Portainer:**

- `AI_MEMORY_AUTH_TOKEN`: Senha forte gerada (ex: via Bitwarden).
- `GEMINI_API_KEY`: Chave gerada no Google AI Studio vinculada ao projeto do GCP.

## 🕵️ 2. O Espião (Windows / Cliente Local)

Para gerar os hooks de interceptação e conversar com o servidor, precisamos do CLI `ai-memory` compilado nativamente no Windows.

> ℹ️ **Sobre os hooks (importante):** para o agente **`claude-code`** no Windows, as versões com suporte nativo (PRs [#83](https://github.com/akitaonrails/ai-memory/pull/83) / [#84](https://github.com/akitaonrails/ai-memory/pull/84)) geram um hook **nativo** — o comando chama o binário `ai-memory.exe` direto (`"…\ai-memory.exe" hook --event …`), sem subir shell, eliminando o overhead do Git Bash a cada tool call (~5× mais rápido). Para voltar ao modo legado (`bash -c` + scripts `.sh` via Git Bash, caminhos `/c/Users/...`), defina `AI_MEMORY_HOOK_PLATFORM=windows-bash` antes do `install-hooks`. O bundle ainda traz os scripts `.sh`/`.ps1` como fallback — e o **Git for Windows (Git Bash)** segue como pré-requisito do modo `windows-bash` e dos outros agentes (Codex, Cursor, Gemini CLI...). Os scripts ficam em `%LOCALAPPDATA%\ai-memory\hooks\claude-code\`.

### Pré-requisitos

- **Git for Windows** — **opcional** com o hook nativo (padrão atual): o `claude-code` não usa mais `bash`. Necessário apenas para o modo legado `AI_MEMORY_HOOK_PLATFORM=windows-bash` (hooks `.sh` via Git Bash) e para outros agentes que usam scripts:
  ```powershell
  winget install Git.Git
  ```
- **Rust / Cargo** — para compilar o CLI (passo abaixo). **Obrigatório.**

### Instalação do Rust

No PowerShell (como Administrador, se necessário), instale o Rustup:

```powershell
winget install Rustlang.Rustup
```

_⚠️ Feche e abra o terminal após a instalação para recarregar as variáveis de ambiente._

### Compilação do CLI

Clone o repositório no Windows e instale o binário globalmente:

```powershell
cd "D:\cateim\Google Drive\GitHub\ai-memory"
cargo install --path crates/ai-memory-cli
```

### Instalação do MCP e Hooks no Claude Code

Com o binário `ai-memory` disponível, aponte os instaladores diretamente para o IP do Orange Pi e forneça o token.

**1. Instalar o servidor MCP:**

```powershell
ai-memory install-mcp --client claude-code --apply --server-url "http://IP_DO_SERVIDOR:49374/mcp" --auth-token "SUA_SENHA_AQUI"
```

**2. Instalar os Hooks de ciclo de vida:**
_Nota: aponte `--hooks-dir` para a pasta `hooks/` do repositório clonado. Com o hook nativo ele apenas faz o staging dos scripts de fallback (o hook em si chama o binário `ai-memory.exe`); no modo `windows-bash` ele define os `.sh` efetivamente executados._

```powershell
ai-memory install-hooks --agent claude-code --apply --hooks-dir "D:\cateim\Google Drive\GitHub\ai-memory\hooks" --server-url "http://IP_DO_SERVIDOR:49374" --auth-token "SUA_SENHA_AQUI"
```

## 🧪 3. Verificação e Teste

Abra o terminal no Antigravity IDE, inicie o `claude` e envie o prompt:

> "Use suas tools do ai-memory para verificar o status da minha memória e me diga se há conexão."

**Resultado Esperado:** O Claude deverá exibir uma tabela com as métricas do banco de dados (Sessões, Observações, Páginas), provando que o hook interceptou o envio e o MCP buscou o status real no Orange Pi.

## 🔄 4. Atualização (Update)

O sistema tem **duas metades** que precisam ser atualizadas e mantidas na **mesma versão**: o **Cérebro** (imagem Docker no Orange Pi) e o **Espião** (CLI `ai-memory` no notebook). Ao atualizar um, atualize o outro.

### 4.1. Atualizar o Cérebro (Orange Pi / Portainer)

A stack fixa a versão da imagem (`akitaonrails/ai-memory:3.3.3`), a mesma do Espião. Com a tag fixa, o Portainer baixa a imagem nova assim que a tag muda, e a versão que roda é sempre a que está escrita no YAML.

Para atualizar:

1. Veja a versão nova em [Docker Hub → Tags](https://hub.docker.com/r/akitaonrails/ai-memory/tags) e leia as notas dela no [CHANGELOG do projeto](https://github.com/akitaonrails/ai-memory/blob/main/CHANGELOG.md).
2. Portainer → **Stacks** → `ai-memory` → **Editor**: troque a tag (ex.: `3.3.3` → `3.3.4`) e clique em **Update the stack**.
3. Troque a mesma tag em [`assets/stacks/ai-memory.yml`](../assets/stacks/ai-memory.yml), para o repositório continuar igual ao servidor.
4. Atualize o Espião para a mesma versão (seção 4.2).

> ⚠️ **Por que não `:latest`:** num **Redeploy** comum, o Portainer **não** baixa a imagem `:latest` de novo; ele reusa o cache local. Em 03/11/2026 o servidor continuou na 3.3.2 com a 3.3.3 já publicada, até a tag ser fixada. Se um dia a stack voltar para `:latest`, marque **`Re-pull image and redeploy`** ao atualizar.

**Alternativa via SSH (sem Portainer):**

```bash
docker pull akitaonrails/ai-memory:3.3.3
# recria o container com a imagem nova (ajuste o caminho da stack):
docker compose -f /caminho/da/stack/ai-memory.yml up -d
```

> 💾 Os dados ficam no bind mount `/srv/ai-memory/data` (no host), então atualizar/recriar o container **não apaga** sua memória.

### 4.2. Atualizar o Espião (CLI no notebook)

O cliente é o binário `ai-memory`, e ele **não** se atualiza junto com a imagem: atualize os dois para a mesma versão.

**No notebook (Omarchy):** o binário vem do pacote `ai-memory-bin` do AUR, que baixa o release oficial do GitHub e confere o checksum.

```bash
yay -S ai-memory-bin
ai-memory --version
```

Os hooks do Claude Code chamam `/usr/bin/ai-memory` direto, então o binário novo vale a partir da próxima chamada, sem reinstalar os hooks. Se as notas da versão pedirem hooks novos, rode de novo o `ai-memory install-hooks --agent claude-code` com as opções da instalação.

**No Windows (setup antigo):** você recompila a partir do repositório clonado e reinstala MCP + Hooks (os scripts de hook são regenerados a partir do binário, então uma versão nova traz hooks novos).

No PowerShell:

```powershell
# 1. Atualizar o código-fonte
cd "D:\cateim\Google Drive\GitHub\ai-memory"
git pull

# 2. Recompilar e reinstalar o binário global (--force garante a recompilação)
cargo install --path crates/ai-memory-cli --force

# 3. Regenerar MCP + Hooks com a versão nova (apontando para o Orange Pi)
ai-memory install-mcp   --client claude-code --apply --server-url "http://IP_DO_SERVIDOR:49374/mcp" --auth-token "SUA_SENHA_AQUI"
ai-memory install-hooks --agent  claude-code --apply --hooks-dir "D:\cateim\Google Drive\GitHub\ai-memory\hooks" --server-url "http://IP_DO_SERVIDOR:49374" --auth-token "SUA_SENHA_AQUI"
```

> Reabra o terminal do Antigravity IDE após atualizar, para recarregar o binário e os hooks.

> 🆕 **Melhorias no Windows (PRs [#83](https://github.com/akitaonrails/ai-memory/pull/83) / [#84](https://github.com/akitaonrails/ai-memory/pull/84)):** com elas, no Windows o `install-hooks` passa a (a) gerar o hook **nativo** (binário direto, ~5× mais rápido que `bash -c`) e (b) **preservar hooks de outros plugins** no mesmo evento. Antes, o `install-hooks --apply` sobrescrevia o array do evento inteiro — removendo, p.ex., um hook `SessionStart` do context-mode (era preciso re-adicionar manualmente após cada update). Enquanto os PRs não forem mergeados no upstream, compile de uma branch local que os inclua.

### 4.3. Manter as versões em sincronia

Confirme que cliente e servidor batem:

- **Cliente (notebook):** `ai-memory --version`
- **Servidor (Orange Pi):** a tag da imagem na stack, ou via SSH no Orange Pi: `docker exec ai-memory /usr/local/bin/ai-memory --version`

Após cada atualização, rode o teste da [seção 3](#-3-verificação-e-teste) para confirmar que o hook + MCP continuam conversando com o Orange Pi.

## 🩺 5. Troubleshooting

### Hooks pararam de gravar memória no Windows (`bash` errado)

> ⚠️ **Só se aplica ao modo legado `windows-bash`.** Com o hook **nativo** (padrão atual, PR #84) o `claude-code` não invoca `bash` — então esse problema não acontece. Se você não definiu `AI_MEMORY_HOOK_PLATFORM=windows-bash`, pode ignorar esta seção.

**Sintoma:** de repente (geralmente após uma atualização do Windows ou a instalação do WSL) a memória deixa de ser gravada e os hooks falham com algo como `No such file or directory` ou `cannot find path`.

**Causa provável:** os hooks do `claude-code` rodam via `bash -c` apontando para caminhos no estilo **Git Bash** (`/c/Users/...`). Se o `bash` resolvido for o do **WSL** em vez do **Git Bash**, esses caminhos não existem (no WSL seriam `/mnt/c/Users/...`) e o hook quebra. No Windows o stub do WSL costuma aparecer **antes** no `PATH`:

```powershell
Get-Command bash -All | Select-Object Source
# C:\Users\<voce>\AppData\Local\Microsoft\WindowsApps\bash.exe   <- WSL (stub)
# C:\Program Files\Git\bin\bash.exe                              <- Git Bash (o correto)
```

**Como resolver:**

1. Faça o **Git Bash** ser o `bash` efetivo. O caminho mais limpo é desativar o alias do WSL: **Configurações do Windows → Aplicativos → Aliases de execução de aplicativo → desligue o `bash.exe` (Ubuntu/WSL)**. Alternativamente, coloque `C:\Program Files\Git\bin` antes de `WindowsApps` no `PATH`.
2. Reabra o terminal do Antigravity IDE.
3. Regenere os hooks para reescrever os comandos com os caminhos corretos:
   ```powershell
   ai-memory install-hooks --agent claude-code --apply --hooks-dir "D:\cateim\Google Drive\GitHub\ai-memory\hooks" --server-url "http://IP_DO_SERVIDOR:49374" --auth-token "SUA_SENHA_AQUI"
   ```
4. Rode o teste da [seção 3](#-3-verificação-e-teste) para confirmar que voltou a gravar.
