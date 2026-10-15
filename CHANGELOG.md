# Changelog

Todas as mudanças notáveis deste repositório são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
As versões seguem o esquema **CalVer `YYYY.M.R`** (ano, mês sem zero à esquerda, revisão do mês), **não** o Versionamento Semântico: `2026.8.1` não diz nada sobre compatibilidade, só quando o conteúdo foi publicado.

## [Unreleased]

### ✨ Added

- **Espelho do Caddyfile em uso** ([`assets/configs/caddy-Caddyfile`](./assets/configs/caddy-Caddyfile)): o arquivo da vps-oracle, linha por linha, com o bloco novo do `monitor.selflabs.org` (painel de monitoramento dos clientes da Hubb) atrás do Authelia e os quatro caminhos abertos de propósito (WebSocket dos agentes do Beszel, sinais, saúde e a marca dos e-mails de alerta), cada um com o motivo.
- **Regra do `monitor.selflabs.org` no espelho do Authelia** ([`assets/configs/authelia.yml`](./assets/configs/authelia.yml)): com `default_policy: deny`, um host novo atrás do forward-auth sem regra própria responde 403 em todas as telas.

### 🔧 Changed

- **Primeiro login do Portainer** ([`docs/portainer-debian.md`](./docs/portainer-debian.md)): o token de setup que a tela pede agora está documentado.
- **O bloco do ALFERES no Caddyfile perdeu o rótulo "(P1)"**, no espelho e no servidor: o sistema vai além do módulo P1.

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

[Unreleased]: https://github.com/cateim/DIY/compare/v2026.9.1...HEAD
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
