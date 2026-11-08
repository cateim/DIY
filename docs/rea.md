# 🔬 REA (engenharia reversa com agentes)

O REA (Reverse Engineer Anything) dá ao agente de IA as ferramentas de engenharia reversa que ele não tem: lê binários nativos, apps JavaScript e Electron, assemblies .NET, APKs, firmware, sites e capturas de rede, sem precisar do código-fonte. Roda no notebook como servidor MCP (229 ferramentas e 6 prompts) e como CLI (`rea`, 175 comandos), e cada resposta vem como **Evidence**: o fato observado, o hash do alvo, o grau de confiança e o que ficou de fora. Com isso o agente explica como uma funcionalidade funciona, mostra a prova e reconstrói algo parecido no nosso projeto.

Exemplo real deste guia: `rea-agents` 6.8.0 no notebook `alienware` (Omarchy, Node 26.13.0 do mise), registrado no Claude Code em 03/11/2026, com o Ghidra 12.1.2 do Arch como motor nativo.

**Pré-requisito:** Node.js 22.x (>= 22.23.4), 24.x (>= 24.22.1) ou 26.12.1+ com npm (no notebook, o do mise), o `ps` do `procps-ng` (o Omarchy já traz) e o [Claude Code](https://code.claude.com/docs).

Não há stack: o REA é uma CLI mais um servidor MCP stdio que o próprio Claude Code sobe a cada sessão. Nada roda em servidor e nenhuma porta fica aberta.

> ⚠️ **Só de fonte oficial:** [`morluto/rea`](https://github.com/morluto/rea), [rea.tools](https://rea.tools/) ou o pacote npm [`rea-agents`](https://www.npmjs.com/package/rea-agents) (mantenedor `morluto`, o mesmo dono do repositório). O próprio README avisa que circulam cópias com nome parecido.

## Como funciona

```
Claude Code (notebook)
 ├─ skill reverse-engineer-anything ... ensina o agente a investigar
 └─ MCP stdio "rea" ─► rea mcp (229 ferramentas, 6 prompts)
       ├─ leitores próprios ........... Go, Rust, ELF, PE, ASAR/JS, .NET, APK, SQLite, GGUF
       ├─ motores opcionais ........... Ghidra, Hopper, IDA, Kuna, JADX, Rizin, GDB, objdump
       ├─ observação em execução ...... Chrome (CDP), Playwright, Frida, adb, PTY
       └─► Evidence (JSON) ............ sha256 do alvo, confiança, limitações, próximos passos
```

1. **Você pede o resultado** em linguagem natural ("como o app X faz Y?"). A skill diz ao agente por onde começar.
2. **O REA lê o alvo na máquina.** Por padrão é estático: o arquivo é lido como dado e nada é executado. As ferramentas que executam algo (navegador, Electron, Frida, captura de processo, adb) declaram o efeito antes; `rea capabilities` lista cada uma com `launches_process`, `may_access_network`, `may_write_filesystem`.
3. **A resposta é Evidence, não opinião.** Cada conclusão traz o hash do alvo, o local exato (arquivo, offset, função), `confidence` e `limitations`. O que não foi provado aparece como desconhecido, nunca como ausência.
4. **O agente segue as pistas** (próximos passos): decompila a função certa, compara versões e, no fim, escreve e testa a reconstrução no nosso código.

Nada vai para um servidor do REA. O que chega ao modelo é o resultado das ferramentas, sob a política do provedor do modelo (a Anthropic, no Claude Code).

Trecho real de uma Evidence (`rea inspect-go-binary /usr/bin/tailscale`):

```json
{
  "subject": { "name": "tailscale", "digest": { "sha256": "57ac875f8b49f0d9..." }, "format": "elf" },
  "provider": { "id": "go-build-info", "name": "REA Go build-information reader" },
  "normalized_result": { "build_info": { "go_version": "go1.27.3-X:nodwarf5" } },
  "confidence": "observed",
  "authority": "shipped-artifact",
  "limitations": [
    "Embedded build metadata is observed file content, not proof of compiler identity, dependency authenticity or runtime behavior."
  ]
}
```

---

## Onde o REA entra no nosso desenvolvimento

| Frente                                      | O que o REA resolve                                                                                                                                                                            | Ferramentas principais                                                                                                      | Pronto hoje?                                                                                           |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **Firmware ESP32** (Jade DIY, Tasmota)      | Conferir um build DIY contra o oficial (chip, versão, IDF, assinatura Secure Boot v2) antes de publicar; inventariar um backup de flash inteiro                                                | `inspect-artifact`, `extract-artifact`; o `.elf` do build num motor nativo                                                  | ⏳ Próxima release ([Parte 5.6](#56-firmware-esp32-na-próxima-release)); o `.elf` já abre no Ghidra    |
| **Integrações do Home Assistant**           | Descobrir a API que o app do fabricante usa: puxar o APK do celular, ler manifest e classes, ver as chamadas numa captura                                                                      | `pull-adb-package`, `inspect-android-package`, `search-android-classes`, `inspect-web-network-capture`                      | ✅                                                                                                     |
| **Scraping e bookmarklets**                 | Achar o endpoint interno, ver como o JavaScript do site monta token ou assinatura, descobrir qual listener o bookmarklet precisa disparar                                                      | `inspect-web-page`, `analyze-web-bundle`, `observe-web-session`, `inspect-web-event-listeners`, `trace-web-source-location` | ✅                                                                                                     |
| **O que nossos apps entregam ao navegador** | Antes do deploy, ler o `dist/` do build: rotas, chamadas, `process.env` embutido e source map publicado sem querer                                                                             | `analyze-javascript-application`, `recover-javascript-sources`                                                              | ✅                                                                                                     |
| **Supply chain do homelab**                 | Versão do Go e dos módulos dos binários que rodam (Caddy, Forgejo, cloudflared, Tailscale; de container, copie o binário antes com `docker cp`), para cruzar com CVE sem depender do changelog | `inspect-go-binary`, `inspect-rust-binary`, `inspect-elf-notes`                                                             | ✅                                                                                                     |
| **"Vi uma feature e quero no meu produto"** | Entender como um app Electron ou nativo implementou algo e reconstruir no nosso código, com a evidência ao lado                                                                                | prompt `investigate_feature`, `analyze-javascript-application`, motor nativo                                                | ✅ JS/Electron e nativo (Ghidra)                                                                       |
| **Hardware e rede de IoT**                  | Decodificar UART, I2C ou SPI gravado num analisador lógico; ler o pcap de um device                                                                                                            | `decode-signal-recording`, `inspect-pcap-capture`                                                                           | ✅ Desde 06/11/2026 ([Parte 6](#parte-6-motores-opcionais-instalar-quando-a-tarefa-pedir))             |

**Onde não entra:** no nosso próprio código-fonte. Para arquitetura de repositório, use a leitura normal; a própria skill do REA manda pular esse caso.

**Ambientes para agentes:** o REA também transforma um HAR de um app nosso em um ambiente onde um agente treina ou é avaliado sem tocar a produção (`rea environment-build sessao.har ./meu-env`). Rodar esse ambiente pede o AgentEnv e Docker, então essa parte fica no servidor, não no notebook.

---

## Parte 1: Instalar a CLI

```bash
npm install --global rea-agents
rea --version
```

- Com o Node do mise, o pacote vai para `~/.local/share/mise/installs/node/<versão>/lib/node_modules/rea-agents` (uns 270 MB com as dependências) e o mise cria o shim do `rea` sozinho.
- O único script que roda na instalação é o do **Frida**, dependência opcional usada pelos comandos `*-frida-*`: ele baixa um binário pronto de 112 MB do release oficial (`github.com/frida/frida`). Nenhum outro pacote da árvore tem script de instalação (conferido na 6.8.0).

> ⚠️ **Se o download do Frida falhar, o script cai no `make` e compila o Frida do zero**, o que prende o notebook por muito tempo. Cancele com `Ctrl+C` e instale sem scripts: `npm install --global rea-agents --ignore-scripts`. Tudo funciona, menos os comandos do Frida.

Alternativa sem instalação global: `npx rea-agents setup`. Funciona, mas o registro passa a depender do cache do npx, e cada conexão MCP mantém um processo do npm. A instalação global é o caminho que o próprio REA recomenda quando há várias sessões do agente abertas ao mesmo tempo, que é o nosso caso (terminal mais a extensão do Antigravity).

---

## Parte 2: Registrar no Claude Code

```bash
rea setup --client claude_code --dry-run   # mostra o plano, não grava nada
rea setup --client claude_code --yes       # aplica o plano
claude mcp get rea                         # Status: ✔ Connected
```

O `setup` faz duas coisas, com backup:

| O quê                                               | Onde                                                                                                                                              |
| :-------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| Servidor MCP `rea`, escopo user (todos os projetos) | `~/.claude.json`, chave `mcpServers.rea`, comando `~/.local/share/mise/installs/node/<versão>/bin/rea mcp`. Backup em `~/.claude.json.rea.backup` |
| Skill `reverse-engineer-anything` (versão 49)       | `~/.claude/skills/reverse-engineer-anything/`                                                                                                     |

Depois, **reinicie o Claude Code** (terminal e extensão do Antigravity). As ferramentas `mcp__rea__*` só aparecem em sessão nova; a skill aparece na hora.

> ℹ️ **229 ferramentas não enchem o contexto no Claude Code.** Com a API da Anthropic, o Claude Code adia as definições das ferramentas MCP (tool search): entram só os nomes, e o schema carrega quando o agente usa a ferramenta. Em cliente sem tool search, ou com `ANTHROPIC_BASE_URL` apontando para outro provedor, o catálogo inteiro vai em toda requisição (centenas de KB). Nesses casos, deixe `REA_MCP_INPUT_SCHEMA_PROFILE=compact` (já é o padrão) e acrescente `REA_MCP_OUTPUT_SCHEMA_PROFILE=compact` no `env` do registro.

O `setup` detectou outros agentes neste notebook (Antigravity, Codex, Gemini CLI, OpenCode, Pi, Droid e Hermes) e eles ficaram de fora de propósito. Para incluir um: `rea setup --client gemini_cli --yes` (a lista de IDs está na [tabela de agentes suportados](https://github.com/morluto/rea/blob/main/docs/installation.md#supported-agents)).

> ⚠️ **Plugin ou setup, nunca os dois.** O REA também existe como plugin do Claude Code (`/plugin marketplace add morluto/rea` e `/plugin install rea@rea`). Os dois juntos sobem dois servidores `rea`. Aqui ficou o `setup`, porque ele deixa o `rea` no terminal e o `rea doctor` enxerga o registro; o plugin não põe nada no PATH e o doctor não vê o estado dele.

---

## Parte 3: Conferir o que está pronto

```bash
rea doctor --client claude_code --skill   # registro e skill: sai 0 quando está tudo certo
rea doctor --json                          # diagnóstico completo, só leitura
rea capabilities                           # o que cada motor faz e os efeitos de cada operação
```

Dentro de uma sessão do agente, peça para ele chamar `binary_session`: o campo `tool_availability` diz o que o servidor em execução consegue usar, com o motivo e a correção de cada ausência.

Estado em 06/11/2026: Node 26.13.0 e `procps-ng` ok, registro e skill ok, Ghidra 12.1.2 com JDK 21 ok (`rea doctor --provider ghidra --json` passa nas 8 checagens) e todos os motores livres da [Parte 6](#parte-6-motores-opcionais-instalar-quando-a-tarefa-pedir) configurados, Kuna incluído. O `binary_session` ainda lista como ausentes: JEB, IDA e Hopper (pagos) e as ferramentas que só existem no macOS. A extração de firmware passou a funcionar no mesmo dia, com o Unblob (Parte 6).

---

## Parte 4: O que dá para analisar

### 4.1. O que ele faz, por verbo

Quase todo pedido é uma combinação destes sete verbos. Saber qual você quer deixa o pedido curto e o caminho do agente direto:

| Verbo                    | O que é                                                                                             | Ferramentas típicas                                                                                    |
| :----------------------- | :-------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **Inventariar**          | Dizer o que é o alvo e o que tem dentro: formato, partes, versões, dependências                     | `inspect_artifact`, `analyze_javascript_application`, `inspect_go_binary`, `binary_overview`           |
| **Achar**                | Ir de uma pista visível (texto da tela, endpoint, mensagem de erro) até o código que a usa          | `search_strings`, `search_procedures`, `trace_feature`, `xrefs`                                        |
| **Ler o código**         | Pseudocódigo, assembly, módulos JavaScript recuperados, métodos de APK                              | `procedure_pseudo_code`, `analyze_function`, `recover_javascript_sources`, `inspect_android_method`    |
| **Seguir o fluxo**       | Quem chama quem, de onde vem um valor, o caminho de um clique até o efeito                          | `get_call_graph`, `trace_call_path`, `trace_native_values`, `trace_application_feature`                |
| **Observar em execução** | O que acontece de verdade: rede e DOM de uma página, IPC do Electron, um processo, um hook do Frida | `observe_web_session`, `capture_browser_scenario`, `capture_process_scenario`, `instrument_with_frida` |
| **Comparar**             | O que mudou entre duas versões, dois builds ou duas capturas                                        | `compare_application_versions`, `compare_artifacts`, `match_native_functions`, `find_changed_behavior` |
| **Reconstruir e provar** | Escrever o equivalente e conferir contra a Evidence; listar o que segue desconhecido                | `verify_reconstruction`, `evaluate_reconstruction_coverage`, `list_unknowns`                           |

### 4.2. Por tipo de alvo

| Alvo                                                 | O que volta                                                                  | Precisa                                       | No notebook hoje         |
| :--------------------------------------------------- | :--------------------------------------------------------------------------- | :-------------------------------------------- | :----------------------- |
| App JavaScript ou Electron (pasta ou `.asar`)        | Módulos, imports, rotas, IPC entre main, preload e renderer, source maps     | `ps` do procps                                | ✅                       |
| Site                                                 | Estrutura, scripts, rede, listeners, screenshots                             | Navegador da família Chrome                   | ✅ Chromium e Chrome     |
| HAR, Fiddler SAZ ou captura do mitmproxy             | Requisições, respostas, payloads expostos e onde estão no código             | Nada para HAR; `mitmdump` para captura nativa | ✅                       |
| Binário Go                                           | Versão do Go, módulos com hash, flags de build                               | Nada                                          | ✅                       |
| Binário Rust                                         | Crates e versões (se compilado com `cargo-auditable`)                        | Nada                                          | ✅                       |
| ELF, PE e Mach-O                                     | Layout, notes, imports, exports, certificados, mitigações                    | Nada                                          | ✅                       |
| .NET                                                 | Metadata, CIL, fronteiras P/Invoke                                           | Nada                                          | ✅                       |
| APK (assinatura e Flutter)                           | Esquemas de assinatura, certificados, hash do snapshot Dart e do engine      | Nada                                          | ✅                       |
| Celular Android                                      | Pacotes, logcat, telas, puxar o APK instalado                                | `adb`                                         | ✅                       |
| Processo de terminal                                 | Saída, interações, arquivos tocados, comparação entre execuções              | PTY (vem no pacote)                           | ✅                       |
| SQLite                                               | Schema e linhas de uma cópia do banco                                        | Node 24.15+ ou 26                             | ✅                       |
| Binário nativo (pseudocódigo, assembly, referências) | Decompilação de funções, strings, chamadas                                   | Ghidra 12.1+, Hopper, IDA ou Kuna             | ✅ Ghidra 12.1.2         |
| APK (manifest, classes e métodos decompilados)       | Declarações, inventário de classes, código Java ou Kotlin, referências       | JAR do `jadx-headless-mcp` 0.7.1 e JDK 17+    | ✅                       |
| Firmware genérico                                    | Regiões (binwalk) e extração (unblob)                                        | `binwalk` e `unblob`                          | ✅                       |
| Imagem ESP32 (app, bootloader, OTA, dump de flash)   | Chip, descritor do app, segmentos, assinatura Secure Boot v2, partições, OTA | Nada                                          | ⏳ Só no `main` (abaixo) |
| pcap/pcapng                                          | Endpoints, DNS, SNI do TLS, protocolos                                       | `tshark` e `capinfos`                         | ✅                       |
| Gravação de analisador lógico                        | Decodificação de UART, I2C, SPI e outros                                     | `sigrok-cli` 0.7.2                            | ✅                       |

A lista completa (GPU, modelos GGUF, Unity IL2CPP, Godot, EVM, PyInstaller, módulos do kernel...) está na [tabela do README do REA](https://github.com/morluto/rea#what-you-can-analyze).

> ⏳ **ESP32 ainda não chegou na versão publicada.** O suporte a imagens ESP entrou no `main` do REA em 28/10/2026 (dumps de flash em 31/10), depois da 6.8.0 (25/10). Na 6.8.0, `rea inspect-artifact jade.bin` responde `unsupported binary format` (testado no `jade.bin` 1.0.38-98 do Waveshare S3). Quando sair a release seguinte: `rea update` e o roteiro da [Parte 5.6](#56-firmware-esp32-na-próxima-release).

> ℹ️ **A documentação do GitHub segue o `main`**, que anda à frente do npm. Antes de copiar um exemplo de lá, confira a versão instalada (`rea --version`) e o `rea <comando> --help`.

---

## Parte 5: Usar

### 5.1. Onde trabalhar: uma sessão por investigação, não um projeto por solução

Não precisa criar um repositório para cada análise. O REA está registrado no escopo user, então toda sessão do Claude Code enxerga as ferramentas, e o alvo entra sempre por caminho absoluto, esteja onde estiver. O que vale separar é a **sessão**: uma investigação despeja muita saída do alvo no contexto, e isso atrapalha a sessão que depois vai escrever o código.

| Situação                                                                         | Onde abrir o Claude Code                           | Por quê                                                                                         |
| :------------------------------------------------------------------------------- | :------------------------------------------------- | :---------------------------------------------------------------------------------------------- |
| Entender como algo de terceiro funciona (app, firmware, API de fabricante, site) | Uma bancada fora do `~/Drive`: `~/Work/re/<alvo>/` | Alvo e Evidence não vão para o drive-sync nem para repositório público, e a sessão começa limpa |
| Implementar no nosso produto o que a investigação provou                         | O repositório do produto, numa sessão nova         | O contexto fica com o código e com a especificação, não com a saída da análise                  |
| Auditar o build de um app nosso (`dist/`)                                        | O próprio repositório do app                       | O alvo é nosso e a correção sai ali mesmo                                                       |
| Pergunta pontual (versão do Go de um binário, assinatura de um APK)              | Qualquer sessão, ou a CLI direto no terminal       | Uma chamada, saída pequena                                                                      |

A bancada sugerida para cada alvo:

```
~/Work/re/<alvo>/
├── alvo/          cópias do que vai ser analisado (APK, .bin, .elf, .asar, HAR), nunca o original
├── evidencias/    o que sair de --evidence_output e de export_evidence_bundle
├── snapshots/     respostas salvas no close_binary (não guardam a análise do Ghidra, Parte 5.5)
└── ACHADOS.md     o que foi provado (com arquivo, função ou offset) e o que ficou desconhecido
```

O fluxo que rende mais usa duas sessões:

1. **Investigar** em `~/Work/re/<alvo>/`. O agente usa o REA e termina escrevendo o `ACHADOS.md`: o que foi provado, a evidência de cada ponto, os desconhecidos e uma especificação curta do que reconstruir.
2. **Implementar** no repositório do produto, em sessão nova: "leia `~/Work/re/<alvo>/ACHADOS.md` e implemente com testes". A sessão começa com o contexto limpo e com a especificação pronta.

### 5.2. Como pedir

Um pedido eficiente tem cinco partes:

| Parte                          | Exemplo                                                                          | Por que ajuda                                                                          |
| :----------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| **Alvo, por caminho absoluto** | `~/Work/re/wiim/alvo/wiim-home.apk`                                              | As ferramentas recusam caminho relativo, e sem alvo o agente gasta chamadas procurando |
| **Uma pergunta fechada**       | "como o app monta a requisição que muda o volume"                                | Uma pergunta vira um rastreio. "Analise o app" vira um inventário caro e raso          |
| **Uma âncora visível**         | Um texto da tela, um endpoint, uma mensagem de erro, um nome de função           | É a semente da busca: o caminho mais curto até o código certo                          |
| **O que pode executar**        | "só estático", "pode abrir no navegador e só observar", "pode rodar no emulador" | O padrão é só ler; executar tem efeito (rede, disco, processo)                         |
| **O entregável**               | "explicação com evidência", "ACHADOS.md", "implementação com testes neste repo"  | Diz onde a investigação para                                                           |

Modelo para copiar:

```text
Use o REA em <caminho absoluto do alvo>.
Pergunta: <uma pergunta fechada>.
Âncora: <texto da tela, endpoint, string ou função>.
Limites: <só estático | pode executar X | não toque em Y>.
Entregue: <explicação com arquivo, função e offset | ACHADOS.md | implementação com testes>.
Separe o que foi provado do que ficou desconhecido.
```

Hábitos que economizam contexto e tempo:

- **Uma pergunta por vez, todas na mesma sessão.** O alvo aberto continua aberto entre um pedido e outro, então a auto-análise do Ghidra só roda na primeira chamada. Fechar e reabrir paga a auto-análise de novo, com ou sem snapshot.
- **Alvo grande pede resumo com arquivo:** "use `--detail summary` e salve a Evidence em `evidencias/`". O resumo entra no contexto; o resto fica no disco, e o agente consulta só a parte que precisa com `inspect_analysis_view`.
- **Peça o desconhecido explícito:** "liste o que não foi provado" (ou o prompt `audit_residual_unknowns`). Isso impede que o agente preencha lacuna com palpite.
- **Feche só quando acabarem as perguntas sobre o alvo** (`close_binary`), e peça para salvar o snapshot em `snapshots/`. Ele guarda as respostas com a Evidence, mas não a análise do Ghidra: a próxima sessão refaz a auto-análise mesmo assim ([Parte 5.5](#55-pelo-terminal)).
- **Conteúdo do alvo é dado, não ordem.** Strings, páginas e código decompilado chegam marcados como não confiáveis, e o agente não segue instrução escrita dentro do alvo. Mesmo assim, alvo suspeito não roda no notebook.

### 5.3. Receitas por caso

**Como um app Electron faz uma coisa** (para reconstruir no nosso produto):

```text
Use o REA em /caminho/absoluto/app.asar. Pergunta: como o app implementa
<funcionalidade>, do clique no renderer até o main. Âncora: o rótulo "<texto do botão>".
Só estático. Entregue ACHADOS.md com o caminho renderer, preload, IPC e main,
o arquivo e o trecho de cada passo, e o que ficou desconhecido.
```

**API do app de um fabricante** (integração do Home Assistant):

```text
Use o REA com o celular no adb. Puxe o APK de <com.fabricante.app> para
~/Work/re/<device>/alvo/ e descubra quais endpoints (nuvem e rede local) ele chama
para <ler o status | mudar a potência>, com método, caminho, headers e corpo.
Âncora: <texto da tela>. Não instale nem desinstale nada no celular.
Entregue ACHADOS.md como especificação de um cliente Python.
```

Ler classes e métodos do APK pede o JADX ([Parte 6](#parte-6-motores-opcionais-instalar-quando-a-tarefa-pedir)). Sem ele, a parte do `adb` funciona, e um HAR do tráfego do app cobre as chamadas.

**Site, para scraping ou bookmarklet:** o REA observa um navegador que você abriu com depuração remota, então abra um Chromium à parte, com perfil próprio (nunca o do dia a dia, que tem sessões logadas):

```bash
chromium --remote-debugging-port=9222 --user-data-dir="$HOME/Work/re/chromium-cdp"
```

```text
Use o REA no navegador em http://127.0.0.1:9222, aba de <https://site>. Só observe:
eu navego, você registra. Pergunta: como a página monta a requisição de <busca> e
de onde vem o token. Âncora: <endpoint ou texto>. Entregue o passo a passo com
arquivo JS e linha de cada etapa, e um esboço do bookmarklet.
```

Para o agente agir sozinho (clicar, preencher), peça um `capture_browser_scenario` em modo launch, que abre um navegador temporário e diz exatamente quais ações fez.

**O que um build nosso entrega ao navegador** (na sessão do próprio repositório):

```text
Use o REA no dist/ deste repositório (caminho absoluto). Pergunta: o que o navegador
recebe que não deveria: rotas internas, endpoints de admin, valores de process.env,
chaves, source maps publicados. Entregue a lista com arquivo e trecho, e a correção
no código ou no build para cada item.
```

**Binário nativo com o Ghidra** (ELF, firmware com ELF, ferramenta fechada):

```text
Use o REA com o Ghidra em /caminho/absoluto/binario. Pergunta: <o que a função X faz |
onde o binário valida Y>. Âncora: <string de log ou da tela>. Mantenha o binário
aberto até o fim das perguntas; ao fechar, salve o snapshot em
~/Work/re/<alvo>/snapshots/. Entregue o pseudocódigo comentado e o que ficou desconhecido.
```

A auto-análise roda a cada sessão nova que abre o binário, e o snapshot não evita isso. No `/usr/bin/true` (43 KB) ela leva uns 20 s e ocupa mais de um núcleo da CPU; num ELF de vários MB, como o `jade.elf` (Xtensa), deve levar bem mais, mas isso ainda não foi medido. Por isso, junte todas as perguntas sobre o binário numa sessão só.

**Duas versões do mesmo alvo:**

```text
Use o REA em <versão antiga> e <versão nova> (caminhos absolutos). Pergunta: o que
mudou em <área>? Use o prompt compare_application_versions e entregue só as
diferenças, com evidência.
```

### 5.4. Prompts guiados do MCP

Os 6 prompts guiados aparecem no Claude Code como comandos `/mcp__rea__<nome>`. Eles montam o roteiro da investigação; você só completa o alvo e a pergunta:

| Prompt                            | Para quê                                                  |
| :-------------------------------- | :-------------------------------------------------------- |
| `investigate_feature`             | Rastrear uma funcionalidade da descoberta até a função    |
| `compare_application_versions`    | Comparar duas versões entregues de um app                 |
| `verify_reconstruction`           | Conferir uma reconstrução contra a Evidence guardada      |
| `trace_crash`                     | Ligar o sintoma de um crash ao caminho no código          |
| `audit_residual_unknowns`         | Listar o que ainda não foi provado                        |
| `prepare_bounded_process_capture` | Planejar uma captura de processo antes de executar o alvo |

### 5.5. Pelo terminal

A saída padrão é TOON, compacta para LLM; use `--json`, `--format yaml` ou `--format md`. Caminhos de alvo sempre absolutos. Exemplos reais, rodados no notebook em 03/11/2026:

```bash
# Binário Go: versão do compilador, módulos e flags de build (2 s)
rea inspect-go-binary /usr/bin/tailscale --json
```

Resultado: Go `1.27.3`, módulo `tailscale.com v1.104.2`, 61 dependências com hash e as flags do build do Arch (PIE, `CGO_ENABLED=1`, `-ldflags` com o commit de origem).

```bash
# App Electron: janelas, preload, contextBridge e IPC (5 s)
mkdir -p ~/rea-evidencias
rea analyze-javascript-application /usr/lib/electron43/resources/default_app.asar \
  --detail summary --evidence_output ~/rea-evidencias/electron-default-app.json --json
```

Resultado: 3 arquivos JavaScript lidos sem executar nada, 1 `BrowserWindow`, 1 preload, 1 API exposta no `contextBridge`, 1 canal IPC com handler no main e nenhuma checagem de remetente observada (o que não prova que ela não exista: falta de achado é desconhecido, não ausência). O resumo sai na tela e a Evidence completa (2,2 MB) fica no arquivo, para o agente consultar depois com `inspect-analysis-view`.

```bash
# Binário nativo com o Ghidra: pseudocódigo de uma função (20 s, quase tudo é a auto-análise)
rea decompile /usr/bin/true --procedure entry --provider ghidra --json
```

Resultado: o pseudocódigo C do `entry`, a chamada a `__libc_start_main` com o `main` (`FUN_00102480`) e o laço final, com `provider` = Ghidra 12.1.2. O projeto do Ghidra é temporário: some ao fechar a sessão, e o binário original nunca é escrito. Pelo agente, o mesmo fluxo é `open_binary` (com `provider_id: ghidra`), `procedure_pseudo_code` e, no fim, `close_binary`, testado com o mesmo resultado; a sessão aberta continua entre um pedido e outro, então só a primeira chamada paga a auto-análise.

> ⚠️ **O snapshot não guarda a análise do Ghidra** (testado em 04/11/2026, REA 6.8.0, no `/usr/bin/true`). Ele é um JSON pequeno (5,7 KB) com o provedor, o perfil de análise e as respostas já obtidas como Evidence. O banco do Ghidra fica de fora, e o projeto temporário é apagado ao fechar.
>
> - **Medido pela CLI:** `rea decompile` com `--snapshot` levou 25 s na primeira vez e 24 s repetindo a mesma consulta. A resposta veio com o mesmo `evidence_id`.
> - **Medido pelo MCP:** o `open_binary` com `snapshot_path` abriu em 1 s. A mesma `procedure_pseudo_code` levou 22 s, e o Java do Ghidra subiu de novo. O `close_binary` gravou `primitive_entries: 0` e `evidence_records: 1`.
> - **Para que serve:** guardar as respostas de uma sessão com a Evidence, para conferir depois ou usar no `verify_reconstruction`. Para ganhar tempo, a saída é manter a sessão aberta. Confira de novo depois de cada `rea update`.

Como salvar e reabrir:

```bash
# CLI: --snapshot carrega o arquivo se ele existir e grava as respostas novas nele
rea decompile /caminho/absoluto/binario --procedure entry --provider ghidra \
  --snapshot ~/Work/re/<alvo>/snapshots/binario.json --json
```

- **No MCP, quem escolhe o caminho é você.** O `close_binary` recebe o `snapshot_path` (absoluto) e só sobrescreve um arquivo existente com `overwrite: true`. Para reabrir, passe o mesmo arquivo no `snapshot_path` do `open_binary`. O snapshot só carrega se o binário, o provedor e o perfil de análise forem os mesmos.
- **Renomear ou comentar funções bloqueia o snapshot.** Depois de um `set_address_name` ou `set_comment`, o `close_binary` não grava mais o snapshot. Exporte com `export_evidence_bundle` antes de fechar.

> 💾 **`--evidence_output` nunca sobrescreve** e é obrigatório com `--detail summary`: use um nome novo a cada análise. **Não grave Evidence dentro do `~/Drive`**: o drive-sync manda tudo para a nuvem na rodada seguinte, inclusive análises de apps de terceiros.

### 5.6. Firmware ESP32 (na próxima release)

Roteiro da documentação do `main`, ainda **não testado aqui** porque a 6.8.0 não tem o leitor:

```bash
# App, bootloader ou OTA: chip, descritor do app, segmentos e assinaturas
rea inspect-artifact /caminho/absoluto/jade.bin --detail summary \
  --evidence_output ~/rea-evidencias/jade.json --json

# Dump de flash inteiro: tabela de partições, otadata e qual slot o bootloader escolhe
rea inspect-artifact /caminho/absoluto/backup-16MB.bin --json

# Um arquivo por segmento e por bloco de assinatura
rea extract-artifact /caminho/absoluto/jade.bin --json
```

- A leitura é estática: não precisa de esptool, placa nem acesso à flash.
- O descritor do app traz projeto, versão, versão do IDF, data do build e o SHA-256 do ELF. É isso que permite conferir que um `jade.bin` DIY saiu do commit e do IDF certos antes de publicar.
- **Limites:** imagem com flash encryption não é reconhecida, ESP8266 é recusado e os segmentos não são desmontados. Para ler código, o caminho é o `.elf` do build num motor nativo; o REA testa no CI a desmontagem Xtensa do Ghidra (`Xtensa:LE:32:default`, a do ESP32-S3).

---

## Parte 6: Motores opcionais (instalar quando a tarefa pedir)

No notebook, todos os motores livres da tabela estão instalados desde 06/11/2026 (o Ghidra desde 04/11). O REA não instala nem atualiza nenhum deles (exceto o Hopper, comercial, com `rea setup --install-hopper`); ele só usa o que você aponta. As versões são as que o REA 6.8.0 verifica:

| Destrava                                      | Instalar (Arch)                                                                 | Apontar para o REA                                                  |
| :-------------------------------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------ |
| Decompilar binário nativo e o `.elf` do ESP32 | `sudo pacman -S ghidra jdk21-openjdk` (Ghidra 12.1.2 em `/opt/ghidra`, 742 MiB) | Nada: acha `/opt/ghidra` sozinho                                    |
| Segundo decompilador nativo                   | Kuna 1.833, um executável só (bloco abaixo)                                     | `REA_KUNA_COMMAND=~/.local/share/rea/bin/kuna` (caminho absoluto)   |
| Regiões de firmware                           | `sudo pacman -S binwalk` (3.1.0)                                                | `REA_BINWALK_COMMAND=/usr/bin/binwalk`                              |
| Extração de firmware                          | Unblob 26.6.4 pelo uv e os extratores dele (bloco abaixo)                       | `REA_UNBLOB_COMMAND=~/.local/bin/unblob` (caminho absoluto)         |
| pcap e campos de protocolo                    | `sudo pacman -S wireshark-cli`                                                  | `REA_TSHARK_COMMAND` e `REA_CAPINFOS_COMMAND`, ou o PATH            |
| Analisador lógico                             | `sudo pacman -S sigrok-cli` (0.7.2)                                             | `REA_SIGROK_COMMAND=/usr/bin/sigrok-cli`                            |
| Captura nativa do mitmproxy                   | `sudo pacman -S mitmproxy` (12.2.3)                                             | `REA_MITMDUMP_COMMAND=/usr/bin/mitmdump`                            |
| WebAssembly                                   | `sudo pacman -S wabt` (1.0.42)                                                  | `REA_WABT_BIN_DIRECTORY=/usr/bin`                                   |
| Layout de ELF e core dump                     | `sudo pacman -S python-pwntools` (4.15.0)                                       | `REA_PWNTOOLS_PYTHON=/usr/bin/python3`                              |
| Sessão de debug do rizin                      | `sudo pacman -S rizin`                                                          | Nada: usa o `rizin` do PATH                                         |
| APK: recursos                                 | `yay -S android-apktool-bin`                                                    | Nada: usa o `apktool` do PATH                                       |
| APK: manifest, classes e métodos              | JAR do `jadx-headless-mcp` 0.7.1 (não é o pacote `jadx` do Arch) e um JDK 17+   | `REA_JADX_MCP_JAR=~/.local/share/rea/android/...` (absoluto)        |
| JavaScript minificado de volta a módulos      | Wakaru 1.14.0, um executável só (bloco abaixo)                                  | `REA_WAKARU_COMMAND=~/.local/share/rea/bin/wakaru` (absoluto)       |

Os pacotes estão no espelho ([`packages.txt`](../assets/omarchy/packages.txt) e [`packages-aur.txt`](../assets/omarchy/packages-aur.txt)). Kuna, Wakaru e o JAR do JADX vêm dos releases do GitHub, conferidos por SHA-256:

```bash
mkdir -p ~/.local/share/rea/bin ~/.local/share/rea/android && cd ~/.local/share/rea
curl -fLO https://github.com/Noelo-Lab/kuna/releases/download/v1.833/kuna-v1.833-linux-x86_64.tar.gz
curl -fLO https://github.com/pionxzh/wakaru/releases/download/v1.14.0/wakaru-linux-x64.tar.gz
curl -fL -o android/jadx-headless-mcp-0.7.1-all.jar https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar
printf '%s\n' \
  'e9f047fb5a93925ede6d869df22c26c1c0ced90764ace7467ae90f880625d530  kuna-v1.833-linux-x86_64.tar.gz' \
  'db0e620034723195ab426e94d00d55dbd8fd0106a928ada2563f1103196d09fa  wakaru-linux-x64.tar.gz' \
  '6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75  android/jadx-headless-mcp-0.7.1-all.jar' > SHA256SUMS
sha256sum -c SHA256SUMS && tar -xzf kuna-v1.833-linux-x86_64.tar.gz -C bin --strip-components=1 kuna-v1.833-linux-x86_64/kuna && tar -xzf wakaru-linux-x64.tar.gz -C bin wakaru && rm ./*.tar.gz
```

**Extração de firmware é só pelo Unblob.** A remediação do `extract_firmware` diz "Binwalk ou Unblob", mas o código do REA 6.8.0 liga a extração só com o `REA_UNBLOB_COMMAND` (`firmwareExtractionEnabled` em `dist/server/createServer.js`); o binwalk serve apenas às regiões. Com o binwalk apontado e sem Unblob, o `binary_session` mostra `extract_firmware` como `provider_missing`, que foi o que aconteceu aqui em 06/11/2026. O Unblob não está nos repositórios nem no AUR; ele vai pelo uv, com o `jefferson` e o `ubireader` que ele mesmo instala expostos no PATH, e os outros extratores vêm do pacman e do AUR:

```bash
uv tool install unblob==26.6.4 --with-executables-from jefferson,ubi-reader
sudo pacman -S --needed erofs-utils lzop partclone unarchiver
gpg --recv-keys 1E5AEE0B18C0DEB45D64AA0325B62C9821501AA0   # chave do lziprecover (Antonio Diaz Diaz); sem ela o yay aborta os dois
yay -S --needed sasquatch lziprecover
unblob --show-external-dependencies   # só o sasquatch-v4be fica com ✗
```

As variáveis entram no `env` do registro de uma vez, com o `claude mcp add-json` (troque `<<HOME>>` pelo seu `$HOME`), e o Claude Code precisa reiniciar, porque o REA lê o ambiente só na partida:

```bash
claude mcp remove -s user rea
claude mcp add-json -s user rea '{
  "type": "stdio",
  "command": "<<HOME>>/.local/share/mise/installs/node/26.13.0/bin/rea",
  "args": ["mcp"],
  "env": {
    "GHIDRA_INSTALL_DIR": "/opt/ghidra",
    "JAVA_HOME": "/usr/lib/jvm/java-21-openjdk",
    "REA_TSHARK_COMMAND": "/usr/bin/tshark",
    "REA_CAPINFOS_COMMAND": "/usr/bin/capinfos",
    "REA_SIGROK_COMMAND": "/usr/bin/sigrok-cli",
    "REA_BINWALK_COMMAND": "/usr/bin/binwalk",
    "REA_UNBLOB_COMMAND": "<<HOME>>/.local/bin/unblob",
    "REA_WABT_BIN_DIRECTORY": "/usr/bin",
    "REA_PWNTOOLS_PYTHON": "/usr/bin/python3",
    "REA_MITMDUMP_COMMAND": "/usr/bin/mitmdump",
    "REA_WAKARU_COMMAND": "<<HOME>>/.local/share/rea/bin/wakaru",
    "REA_KUNA_COMMAND": "<<HOME>>/.local/share/rea/bin/kuna",
    "REA_JADX_MCP_JAR": "<<HOME>>/.local/share/rea/android/jadx-headless-mcp-0.7.1-all.jar"
  }
}'
```

**Conferido em 06/11/2026**, depois do reinício: o `binary_session` lista Ghidra e Kuna como `available`, e o `inspect_packet_capture` leu um pcap de DNS da TV pelo `tshark` apontado na variável. Com o Unblob, num segundo reinício, o `extract_firmware` passou a `available` e extraiu um arquivo de teste com um zip e um gzip colados: 2 chunks, cobertura `complete`, nenhum `extraction_gaps`. Continuam fora:

- `sasquatch-v4be`, o extrator de SquashFS 4 big-endian do Unblob (raro, alguns roteadores): o `sasquatch` do AUR compila só o `sasquatch`.
- JEB, IDA e Hopper, que são pagos.
- Cutter (o plugin do REA para ele é experimental e vai à mão na pasta de plugins) e pwndbg (o REA exige o caminho de um venv do pwndbg).
- O que só existe no macOS: `inspect_macho`, plist, Swift, asset catalog, assinatura de código e UI nativa.

> ℹ️ **Por que `jdk21-openjdk` junto do Ghidra:** o pacote do Arch pede um JDK (`java-environment>=21`) e o pacman pergunta qual instalar. O REA aceita JDK 21 ou mais novo com o Ghidra 12.1 e foi verificado com o 21, então fica o 21 para não haver pergunta.

**Ghidra, testado em 04/11/2026:** o REA encontra o pacote do Arch em `/opt/ghidra` sem variável nenhuma, tanto na CLI quanto no MCP (o servidor que já estava rodando passou a listar o Ghidra como `available` logo depois do `pacman`). Mesmo assim, o caminho ficou fixo no registro do Claude Code, para não depender da descoberta:

```bash
GHIDRA_INSTALL_DIR=/opt/ghidra rea doctor --provider ghidra --json        # 8 checagens ok: versão, headless, decompilador nativo, JDK
GHIDRA_INSTALL_DIR=/opt/ghidra rea setup --client claude_code --dry-run   # 1 ação: só o env do registro
GHIDRA_INSTALL_DIR=/opt/ghidra rea setup --client claude_code --yes
```

O setup grava `GHIDRA_INSTALL_DIR=/opt/ghidra` e `JAVA_HOME=/usr/lib/jvm/java-21-openjdk` no `env` de `mcpServers.rea` (`~/.claude.json`) e preserva esses valores nas próximas execuções. Vale para todo motor da tabela: na CLI, a variável vem do shell; no MCP, rode o setup com ela no ambiente e reinicie o Claude Code.

---

## Parte 7: Atualizar

O REA solta versão a cada poucos dias (da 6.1 à 6.8 entre 09/10 e 25/10/2026). Atualize antes de investigar um erro:

```bash
rea update                                 # atualiza a instalação global e confere a release
rea setup --client claude_code --yes       # renova registro e skill (o update imprime esse comando)
```

Depois, reinicie o Claude Code.

> ⚠️ **Trocou o Node do mise? Reinstale.** O pacote global mora dentro da versão do Node (`.../installs/node/26.13.0/...`), e o registro do MCP aponta para esse caminho. Depois de `mise use -g node@<nova>`, rode de novo `npm install --global rea-agents` e `rea setup --client claude_code --yes`. Enquanto a versão antiga continuar instalada, o registro antigo segue funcionando; um `mise prune` que a remova quebra o MCP.

---

## Parte 8: Remover

```bash
rea uninstall                  # tira registro e skill de todos os agentes onde o REA se registrou
rea uninstall --purge-data     # também apaga o estado (~/.rea) e os caches do Kuna e do Hopper em ~/.cache/rea
npm uninstall --global rea-agents
```

O `uninstall` não mexe no Node, nas Evidence, nas capturas, em outras skills nem em outros servidores MCP.

---

## Troubleshooting

| Sintoma                                                         | Causa                                                                       | Correção                                                                                                     |
| :-------------------------------------------------------------- | :-------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| Ferramentas `mcp__rea__*` não aparecem no agente                | A sessão foi aberta antes do `setup`                                        | Reinicie o Claude Code; `claude mcp get rea` deve dizer `Connected`                                          |
| `rea` some ou o MCP falha só em um projeto                      | O projeto fixa outra versão do Node no mise, e o `rea` usa o `node` do PATH | `mise exec node@26.13.0 -- rea ...`, ou instale o REA também nessa versão (precisa estar na faixa suportada) |
| `unsupported binary format` num `.bin` de ESP32                 | O leitor de imagens ESP ainda não foi publicado (6.8.0)                     | Aguarde a release seguinte (Parte 4)                                                                         |
| `Summary delivery requires --evidence_output`                   | `--detail summary` sem arquivo de saída                                     | Acrescente `--evidence_output` com um arquivo novo                                                           |
| `GHIDRA_INSTALL_DIR is not set` no `rea doctor`                 | Ghidra não instalado ou não apontado                                        | [Parte 6](#parte-6-motores-opcionais-instalar-quando-a-tarefa-pedir)                                         |
| Motor (Ghidra, JADX, firmware) recusa iniciar com erro genérico | Falta um `ps` compatível com o procps no PATH do REA                        | `pacman -Qo /usr/bin/ps` deve responder `procps-ng`                                                          |
| `env: node: No such file or directory` no log do MCP            | O agente subiu sem o Node do mise no PATH                                   | Abra o agente a partir de um shell com o mise ativo e rode o `setup` de novo                                 |
| `npm install` parado muito tempo compilando                     | O download do binário do Frida falhou e o script caiu no `make`             | `Ctrl+C` e `npm install --global rea-agents --ignore-scripts`                                                |
| Dois servidores `rea` no `/mcp`                                 | Plugin e `setup` instalados juntos                                          | Fique com um: `claude plugin uninstall rea@rea` ou `rea uninstall`                                           |
| Ghidra refaz a auto-análise mesmo reabrindo com snapshot        | O snapshot guarda respostas e Evidence, não o banco do Ghidra (6.8.0)       | Faça todas as perguntas numa sessão só e feche no fim ([Parte 5.5](#55-pelo-terminal))                       |

---

## Notas Importantes

- **Uso legítimo.** O REA é para pesquisa, interoperabilidade, preservação e análise de software próprio ou com autorização ([DISCLAIMER do REA](https://github.com/morluto/rea/blob/main/DISCLAIMER.md)). A licença de um app comercial pode proibir engenharia reversa: confira antes. IDA, Hopper e JEB só com licença legítima.
- **Estático por padrão, execução com as suas permissões.** Ler um arquivo não executa nada. As ferramentas de execução (navegador, Electron, Frida, captura de processo, adb) rodam como o seu usuário: alvo suspeito vai para uma VM, nunca direto no notebook.
- **Evidence é dado sensível.** Uma análise de app de terceiro ou de captura de rede pode conter tokens e dados pessoais. Fica fora do `~/Drive` e fora de repositório público.
- **Registro em escopo user.** O `rea` aparece em todos os projetos. Para restringir a um projeto ou a um perfil separado do Claude Code, veja [Limit REA to one project or agent profile](https://github.com/morluto/rea/blob/main/docs/installation.md#limit-rea-to-one-project-or-agent-profile).

---

## Acessos

| Recurso            | URL / Local                                                                   |
| :----------------- | :---------------------------------------------------------------------------- |
| **CLI**            | `rea` (`~/.local/share/mise/installs/node/26.13.0/bin/rea`)                   |
| **Registro MCP**   | `~/.claude.json`, chave `mcpServers.rea` (backup `~/.claude.json.rea.backup`) |
| **Skill**          | `~/.claude/skills/reverse-engineer-anything/`                                 |
| **Ghidra**         | `/opt/ghidra` (pacote `ghidra`), JDK em `/usr/lib/jvm/java-21-openjdk`        |
| **Cache e estado** | `~/.rea` e subpastas de `~/.cache/rea` (só aparecem quando um motor precisa)  |
| **Evidence**       | Onde `--evidence_output` mandar (sugestão: `~/rea-evidencias/`)               |
| **Site e guias**   | [rea.tools](https://rea.tools/)                                               |
| **Pacote npm**     | [`rea-agents`](https://www.npmjs.com/package/rea-agents)                      |

---

## Referências

- [REA no GitHub](https://github.com/morluto/rea) · [README em português](https://github.com/morluto/rea/blob/main/docs/readme/README_pt-BR.md)
- [Instalação e setup](https://github.com/morluto/rea/blob/main/docs/installation.md) · [Configuração por cliente](https://github.com/morluto/rea/blob/main/docs/client-configuration.md)
- [CLI e Evidence](https://github.com/morluto/rea/blob/main/docs/cli.md) · [Contratos do MCP e catálogo de ferramentas](https://github.com/morluto/rea/blob/main/docs/mcp-contracts.md)
- [Imagens ESP](https://github.com/morluto/rea/blob/main/docs/esp-image.md) · [Dumps de flash ESP](https://github.com/morluto/rea/blob/main/docs/esp-flash-image.md) · [Firmware](https://github.com/morluto/rea/blob/main/docs/firmware-analysis.md)
