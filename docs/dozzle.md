# 📜 Dozzle (Logs, Uso e Saúde dos Containers, com Login)

Este guia sobe o **[Dozzle](https://dozzle.dev)**, um painel web que mostra os containers de um host: os **logs ao vivo**, o uso de **CPU, memória, rede e disco** de cada um, um cartão com a saúde do próprio host e o estado de saúde que o Docker reporta. Desde a **v11** (setembro de 2026) ele tem **login próprio configurável pela tela**, e as configurações feitas na tela ficam gravadas na pasta `/data`. É um container só, sem banco, com os dados em `/srv/dozzle`, no mesmo padrão dos outros guias do repo.

**Pré-requisito:** Docker + Portainer ([./portainer-debian.md](./portainer-debian.md)).

A stack pronta está em [`assets/stacks/dozzle.yml`](../assets/stacks/dozzle.yml).

> [!WARNING]
> **Sem login, qualquer um que alcance a porta lê os logs de todos os containers**, e log costuma carregar token, e-mail e endereço interno. Ligue o login da Parte 3 antes de abrir o Dozzle para mais alguém, e nunca publique a porta na internet sem ele.

## Arquitetura

| Porta Host | Porta Container | Uso                                                         |
| :--------- | :-------------- | :---------------------------------------------------------- |
| `8086/tcp` | `8080`          | Interface web do Dozzle (LAN, ou alvo do Cloudflare Tunnel) |

| Pasta no host             | No container | O que guarda                                                                                                   |
| :------------------------ | :----------- | :------------------------------------------------------------------------------------------------------------- |
| `/srv/dozzle/data`        | `/data`      | `dozzle.yml` (o que a tela de Configurações salva), `users.yml`, `session_secret`, alertas e perfis de usuário |
| `/proc` (somente leitura) | `/host/proc` | Carga e tempo ligado do host no cartão do topo                                                                 |

O Dozzle lê tudo pelo socket do Docker. Ele não guarda os logs: mostra o que o Docker tem.

---

## Parte 1: Preparar a Pasta de Dados

```bash
sudo mkdir -p /srv/dozzle/data
```

O container roda como `root`, então a pasta não precisa de `chown`. Ela precisa **existir antes da stack**: sem o volume, o Dozzle sobe normalmente, mas a tela de Configurações avisa que `/data` não está montado e não salva nada, nem o login.

## Parte 2: A Stack (Deploy)

### Deploy via Portainer (Stack)

1. Portainer → **Stacks** → **Add Stack**.
2. **Nome:** `dozzle`.
3. Cole o YAML de [`assets/stacks/dozzle.yml`](../assets/stacks/dozzle.yml) no **Web editor**.
4. Nenhuma variável de ambiente é obrigatória.
5. **Deploy the stack**.

Abra `http://IP_DO_SERVIDOR:8086`. Num `/data` vazio, o Dozzle abre um assistente de primeira configuração que começa pelo login (Parte 3).

> **Alternativa via SSH:** com o `dozzle.yml` numa pasta do host, `docker compose -f dozzle.yml up -d` sobe a mesma stack. Use um caminho ou o outro: a stack criada pelo shell não aparece como editável no Portainer.

## Parte 3: Login

O login vale para a tela inteira. Há três jeitos, e o primeiro é o mais simples para um homelab:

### 3.1. Conta do próprio Dozzle (pela tela)

No assistente da primeira abertura, ou em **Configurações** (engrenagem) → **Segurança** → **Login**, escolha a **conta do Dozzle**, defina usuário e senha e salve. O Dozzle grava o usuário em `/data/users.yml`, marca `authProvider: simple` em `/data/dozzle.yml` e reinicia sozinho para aplicar.

Enquanto não há login, quase nada da tela de Segurança muda: ações, shell, hosts e atualizações pedem um usuário logado. A exceção é uma janela de 15 minutos num `/data` vazio, que é a do assistente.

### 3.2. Usuários por comando

Para criar o arquivo sem a tela (vários usuários, ou um usuário com permissões menores), gere o `users.yml` com a própria imagem e grave na pasta de dados:

```bash
sudo docker run --rm amir20/dozzle:latest generate admin \
  --password 'SUA_SENHA_AQUI' --email voce@exemplo.com --name "Seu Nome" \
  | sudo tee /srv/dozzle/data/users.yml > /dev/null
```

Sem o `--password`, o comando pergunta a senha. O arquivo fica assim:

```yaml
users:
  admin:
    email: voce@exemplo.com
    name: Seu Nome
    password: $2a$11$...
    filter:
    roles:
```

- **`roles`** vazio dá todas as permissões. As opções são `shell`, `actions`, `download`, `notifications`, `cloud`, `all` e `none`, e um `^` na frente tira uma delas: `all,^shell` é tudo menos o shell.
- **`filter`** limita os containers que o usuário enxerga (ex.: `name=homeassistant`).
- Depois, ligue o provedor: `DOZZLE_AUTH_PROVIDER=simple` no `environment:` da stack, ou pela tela em **Segurança**. Pela variável, o campo fica travado na tela.
- **Editar o `users.yml` desloga todo mundo.**

### 3.3. Pelo Authelia ou outro proxy

Se o Dozzle ficar atrás do [Caddy](./caddy.md) com o [Authelia](./authelia.md), use `DOZZLE_AUTH_PROVIDER=forward-proxy`: o Dozzle confia nos cabeçalhos `Remote-User`, `Remote-Email` e `Remote-Name` que o forward-auth injeta. Duas regras:

- **Não publique a porta** (`expose` no lugar de `ports`): quem chegar direto na 8080 manda o cabeçalho que quiser.
- **Mapeie os grupos para papéis**, senão todo usuário logado ganha todas as permissões: `DOZZLE_AUTH_HEADER_ROLES=Remote-Groups`, com grupos no lldap chamados `dozzle_` mais o papel (`dozzle_shell`, `dozzle_actions`...). Grupos com outro nome são ignorados.

O Dozzle também aceita OIDC (`DOZZLE_AUTH_PROVIDER=oidc`, com o próprio Authelia como provedor), descrito na [documentação de autenticação](https://dozzle.dev/guide/authentication).

## Parte 4: Ações e Shell

**Configurações** → **Segurança** → **Ações e shell**, os dois desligados por padrão:

- **Iniciar, parar e reiniciar:** corrige um container travado na mesma página do erro. Também é o que permite as atualizações da Parte 6.
- **Shell:** abre um terminal dentro do container. Equivale a um `docker exec`, que quase sempre é o mesmo que acesso ao host.

Só ligue com o login da Parte 3 ativo, e de preferência só para o seu usuário (papel `shell` ou `actions`). Pela stack, as variáveis são `DOZZLE_ENABLE_ACTIONS=true` e `DOZZLE_ENABLE_SHELL=true`.

## Parte 5: Migrar um Dozzle sem `/data`

Um Dozzle que subiu antes deste guia costuma ter só o socket montado. A tela de **Segurança** mostra o aviso de `/data` não montado e "Sem login (`auth: none`)". Para trazê-lo ao padrão:

1. Crie a pasta (Parte 1).
2. Portainer → **Stacks** → `dozzle` → aba **Editor**: troque o YAML pelo de [`assets/stacks/dozzle.yml`](../assets/stacks/dozzle.yml), mantendo a porta que o seu já usa.
3. **Update the stack**.
4. A stack antiga, sem rede declarada, deixou o Compose criar a `dozzle_default`. O container já passou para a `dozzle-net`, então apague a sobra: `sudo docker network rm dozzle_default`.
5. Abra a tela e crie a conta (Parte 3.1). O aviso de `/data` some.

Os logs não se perdem, porque moram no Docker. O gráfico curto de uso de cada container recomeça do zero.

## Parte 6: Atualização

- **Pela stack:** Portainer → **Stacks** → `dozzle` → **Re-pull image and redeploy**. Um redeploy sem o re-pull reaproveita a imagem em cache.
- **Pelo próprio Dozzle:** desde a v11 ele confere se há imagem nova para cada container (**Configurações** → **Atualizações**) e pode atualizar sozinho no horário escolhido, inclusive a si mesmo. Isso precisa das ações ligadas (Parte 4) e, por padrão, só atualiza containers com a label `dev.dozzle.update: auto`. Num host que já tem Watchtower, deixe um só fazendo isso.

## Parte 7: Saúde dos Containers

O ícone de saúde ao lado de cada container vem do **`HEALTHCHECK` do Docker**, o mesmo que o `docker ps` mostra como `(healthy)`. O Dozzle não testa nada por conta própria. Um container sem healthcheck aparece só com o ponto de "rodando", sem ícone, e o caminho para mostrar a saúde dele é declarar um `healthcheck:` na stack, com um comando que a imagem tenha (`curl`, `wget`, `python3`). Imagens sem shell nem cliente HTTP, como a do Portainer, não têm como se testar.

O Dozzle também manda **alertas**, pela página **Notifications**: por um texto nos logs, por uso de CPU ou memória, ou por evento do Docker, inclusive `health_status`, `die` e `oom`, para Slack, Discord, ntfy ou um webhook próprio. As regras ficam em `/data`, e um token de webhook pode ficar numa variável (`${VAR}`) em vez de no arquivo.

---

## Troubleshooting

| Sintoma                                                    | Causa e correção                                                                                                             |
| :--------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| "/data não está montado, então não é possível salvar isto" | A stack não monta `/srv/dozzle/data:/data`. Parte 5.                                                                         |
| Todo mundo deslogado a cada restart                        | O `/data` não é gravável, e o Dozzle guarda a chave das sessões só na memória. Confira o volume e a pasta.                   |
| Login antigo parou de funcionar depois da v11              | A v11.0.1 recusa senha em SHA-256 no `users.yml`; só bcrypt. Gere de novo com o comando da Parte 3.2.                        |
| Todos deslogados uma vez depois de atualizar para a v11    | Esperado: a v11 passou a assinar as sessões com uma chave nova em `/data/session_secret`.                                    |
| `--health-cmd` no `docker run` não funciona                | Bug do Docker documentado pelo Dozzle; use o bloco `healthcheck:` da stack.                                                  |
| Container `unhealthy` logo depois de subir                 | O Dozzle só responde ao healthcheck quando já fala com o Docker. Confira o volume do socket.                                 |
| Toggle de ações ou shell travado na tela                   | Ou não há login (Parte 3), ou a variável de ambiente correspondente está fixada na stack: a variável sempre vence o arquivo. |

---

## Notas Importantes

- **O `:ro` do socket não protege nada.** O Docker aceita qualquer comando pelo socket montado em somente leitura. A proteção é o login e manter ações e shell desligados.
- **O agente remoto espera conexão de entrada.** Para ver outro host na mesma tela, o Dozzle principal **liga para** o agente na porta `7007` daquele host (**Configurações** → **Hosts**). Não há modo em que o agente conecte para fora, então um servidor atrás de NAT só entra com a porta alcançável, por exemplo pela [Tailscale](./tailscale.md). Gere um certificado próprio para essa conexão (`generate-certs`, na [documentação do agente](https://dozzle.dev/guide/agent)): o que vem na imagem é igual em todas as instalações.
- **Não há API estável para outro programa ler os containers.** O que existe é um servidor MCP (`DOZZLE_ENABLE_MCP=true`, em `/api/mcp`) para assistentes de IA, só leitura. Sem login, esse endereço fica aberto para quem alcançar a porta.
- **Uma instância lê só os containers do host dela**, mais os dos agentes que ela alcança. Os dados vêm do Docker na hora: nada de histórico além do que o Docker guarda nos logs.

---

## Acessos

| Recurso                            | URL / Local                   |
| :--------------------------------- | :---------------------------- |
| **Web UI**                         | `http://IP_DO_SERVIDOR:8086`  |
| **Portainer**                      | Stack `dozzle`                |
| **Dados (host)**                   | `/srv/dozzle/data`            |
| **Configurações salvas pela tela** | `/srv/dozzle/data/dozzle.yml` |
| **Usuários**                       | `/srv/dozzle/data/users.yml`  |

---

## Referências

- [Dozzle: documentação](https://dozzle.dev/guide/getting-started)
- [Dozzle: autenticação](https://dozzle.dev/guide/authentication) · [usuários do provedor simples](https://dozzle.dev/guide/authentication/simple) · [forward proxy](https://dozzle.dev/guide/authentication/forward-proxy)
- [Dozzle: agentes e outros hosts](https://dozzle.dev/guide/agent)
- [Dozzle: healthcheck](https://dozzle.dev/guide/healthcheck)
- [Dozzle: novidades da v11](https://dozzle.dev/guide/whats-new)
- [Repositório oficial (GitHub)](https://github.com/amir20/dozzle)
