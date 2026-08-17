# 🔀 Caddy (Reverse Proxy + forward-auth do Authelia)

Um **Caddy compartilhado** que fica na frente dos seus apps: roteia por hostname e, nos hosts protegidos, exige login no **[Authelia](./authelia.md)** antes de deixar passar (padrão _forward-auth_). É **uma stack só para todos os projetos** — cada app novo só entra na rede `caddy-net` e ganha um bloco no Caddyfile.

O `cloudflared` (bare-metal) passa a apontar **todos** os hostnames para este Caddy (`http://localhost:8080`), que decide para onde vai cada Host.

> ℹ️ Este guia é a metade "porteiro de rota". A metade "identidade" (quem loga, quais usuários) está em **[Authelia + lldap](./authelia.md)** — os dois trabalham juntos.

**Pré-requisito:** Docker + Portainer ([./portainer-debian.md](./portainer-debian.md)) e a stack **[authelia](./authelia.md)** no ar.

A stack pronta está em [`assets/stacks/caddy.yml`](../assets/stacks/caddy.yml) e a config em [`assets/configs/caddy-Caddyfile`](../assets/configs/caddy-Caddyfile).

## Topologia

```
Cloudflare (TLS) → Cloudflare Tunnel → cloudflared (host) → http://localhost:8080
                                                                      │  (Caddy)
        rede auth-net  ──► authelia:9091 (forward-auth)  ◄────────────┤
        rede auth-net  ──► lldap:17170 (UI de usuários)  ◄────────────┤
        rede caddy-net ──► bentopdf:8080 (e outros apps) ◄────────────┘
```

Só o Caddy publica porta no host (presa em `127.0.0.1:8080`). Ele cruza **duas redes**: `caddy-net` (apps) e `auth-net` (Authelia/lldap). Os apps ficam só na `caddy-net`, sem porta no host.

## Parte 1: Redes e pastas (via SSH, uma vez)

```bash
docker network create caddy-net       # Caddy <-> apps
docker network create auth-net   # Caddy <-> Authelia/lldap
sudo mkdir -p /srv/caddy/{data,config}
```

Grave o Caddyfile em `/srv/caddy/Caddyfile` (conteúdo de [`assets/configs/caddy-Caddyfile`](../assets/configs/caddy-Caddyfile)). Ajuste os hostnames (`*.selflabs.org`) para o seu domínio.

> ⚠️ Suba a stack **[authelia](./authelia.md)** primeiro (ela cria/usa a `auth-net`). Se a `auth-net` não existir, o deploy do Caddy falha com `network auth-net not found`.

## Parte 2: Deploy no Portainer

1. Portainer → **Stacks** → **Add Stack** → Nome: `caddy`.
2. Cole o YAML de [`assets/stacks/caddy.yml`](../assets/stacks/caddy.yml) no editor.
3. **Deploy the stack**.

> Via SSH (alternativa): `docker compose -f caddy.yml up -d`.

## Parte 3: Exposição via Cloudflare Tunnel (sem IP fixo)

**Você não precisa de IP fixo nem abrir portas no roteador.** O `cloudflared` (bare-metal no host) faz uma conexão de **saída** para o Cloudflare; o tráfego dos visitantes chega ao Cloudflare e **desce pelo túnel** até você. Seu IP nunca é exposto e funciona **mesmo atrás de CGNAT** (o caso da maioria das operadoras residenciais). Se o IP mudar, o túnel reconecta sozinho.

```
Navegador (https://pdf.selflabs.org)
  → Cloudflare (DNS + termina o TLS)
  → Túnel (conexão de saída do seu cloudflared)
  → cloudflared (host) → http://localhost:8080
  → Caddy (roteia + forward-auth) → app
```

No painel **Cloudflare Zero Trust → Tunnels → Public Hostname**, aponte **todos** os hostnames para o Caddy (ao criar, o Cloudflare cria o registro DNS sozinho):

| Hostname             | Service                 |
| :------------------- | :---------------------- |
| `auth.selflabs.org`  | `http://localhost:8080` |
| `users.selflabs.org` | `http://localhost:8080` |
| `pdf.selflabs.org`   | `http://localhost:8080` |

O Caddy separa por Host header. O Cloudflare força HTTPS na borda, então o `X-Forwarded-Proto: https` chega ao Caddy (essencial para o Authelia não cair em loop de redirect).

> ℹ️ **Tunnel ≠ Access.** O **Tunnel** é só a **exposição** (leva o tráfego até sua casa sem IP fixo). O **Cloudflare Access** seria um login na borda do Cloudflare — que **não** usamos aqui: quem autentica é o **Authelia** (self-hosted). Tunnel para expor, Authelia para logar.

## Parte 4: Proteger um app novo (o "reuso")

1. **O app entra na rede `caddy-net`** — no compose dele:
   ```yaml
   networks:
     - caddy-net
   # ...
   networks:
     caddy-net:
       name: caddy-net
       external: true
   ```
   e troque `ports:` por `expose:` (não publique porta no host).
2. **Adicione um bloco no Caddyfile** (`/srv/caddy/Caddyfile`):
   ```caddy
   http://novo.selflabs.org {
       import authelia
       reverse_proxy nome-do-container:porta
   }
   ```
   Remova o `import authelia` se o app **não** precisar de login.
3. **Recarregue o Caddy:** `docker restart caddy` (~2s). ⚠️ O `caddy reload` **não** funciona aqui — o `admin off` desliga a API de admin na `:2019`, então o restart (que relê o Caddyfile no boot) é o caminho.
4. **cloudflared:** publique `novo.selflabs.org → http://localhost:8080`.

> 💡 **Proteger apenas um trecho do app.** Quando só uma parte precisa de login (ex.:
> `radar.selflabs.org`, onde o `/admin` é privado mas a landing, os shortlinks e os
> webhooks são públicos), **não** use `import authelia` no host inteiro: passe um
> **matcher** ao `forward_auth`.
>
> ```caddy
> http://radar.selflabs.org {
>     @admin path /admin /admin/*
>     forward_auth @admin authelia:9091 {
>         uri /api/authz/forward-auth
>         copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
>     }
>     reverse_proxy radar-backend:8082
> }
> ```
>
> ⚠️ Use `path /admin /admin/*`, **nunca** `path /admin*`: este último casaria também
> `/administrador` e qualquer outro path com o mesmo prefixo textual.
>
> A vantagem sobre liberar o resto com `bypass` no Authelia é que webhooks e links
> públicos **não** pagam round-trip ao Authelia, nem caem junto se ele ficar indisponível.

## Parte 5: Atualizar

- **Imagem do Caddy:** Portainer → stack `caddy` → **Re-pull image and redeploy**.
- **Só o Caddyfile mudou:** `docker restart caddy` (relê o Caddyfile em ~2s). O `caddy reload` falha por causa do `admin off` (sem API na `:2019`).

## Parte 6: Compressão (uma linha que vale mais que otimizar o app)

O Caddy **não comprime nada por padrão**. Sem a diretiva `encode`, todo HTML, CSS,
JS e JSON sai com o tamanho bruto, mesmo o navegador anunciando
`Accept-Encoding: gzip, br, zstd`.

Medido num app real (frontend do ALFERES, já minificado pelo esbuild):

| Situação     | Trafegado |
| :----------- | :-------- |
| Sem `encode` | 59 KB     |
| `gzip`       | 17 KB     |
| `zstd`       | ~14 KB    |

Cerca de **70% a menos** trocando uma linha. Nenhum ajuste de bundle, minify ou
tree shaking chega perto, e todos eles custam horas.

> ⛔ **`encode` NÃO é opção global.** Pôr a linha dentro do bloco `{ }` do topo
> derruba o Caddy num loop de restart, e com ele **todos** os apps do host:
>
> ```
> Error: adapting config using caddyfile: /etc/caddy/Caddyfile:15: unrecognized global option: encode
> ```
>
> O bloco global só aceita opções de servidor (`auto_https`, `http_port`,
> `admin`, `servers`, `log`). `encode` é **diretiva de handler** e vive dentro de
> um bloco de site. Não existe como ligar compressão para todos os sites de uma
> vez; o mais próximo é um snippet importado em cada um.

**Jeito 1, direto no site.** Bom para ligar num app e conferir antes de mexer
no resto:

```caddyfile
http://alferes.selflabs.org {
	encode zstd gzip
	reverse_proxy alferes-app:3000
}
```

**Jeito 2, snippet.** Quando já forem vários sites, evita repetir e esquecer:

```caddyfile
# Comprime o que o cliente aceitar. A ordem é a preferência do servidor: zstd
# primeiro por ser mais rápido e menor, gzip como reserva para cliente antigo.
# O Caddy escolhe pelo Accept-Encoding e não recomprime o que já chega
# comprimido (jpeg, png, zip, mp4).
(comprimir) {
	encode zstd gzip
}

http://alferes.selflabs.org {
	import comprimir
	reverse_proxy alferes-app:3000
}
```

Depois: `docker restart caddy`.

⚠️ **Confirme que o container subiu antes de comemorar.** Erro de sintaxe no
Caddyfile não aparece no `docker restart`, que imprime o nome do container e sai
com sucesso mesmo quando o Caddy morre logo depois:

```bash
docker ps --filter name=caddy --format '{{.Names}} {{.Status}}'   # tem de dizer "Up"
docker logs caddy --tail 20                                       # sem "Error: adapting config"
```

**Como conferir se a compressão pegou:**

```bash
curl -s -o /dev/null -D - -H 'Accept-Encoding: zstd, gzip' https://SEU-APP/ \
  | grep -iE 'content-encoding|content-length'
```

Tem de responder `Content-Encoding: zstd` (ou `gzip`). Se não vier nada, a causa
mais provável **não** é a diretiva: é o Caddy estar fora do ar por erro de
sintaxe. Confira o `docker ps` acima primeiro.

**Resposta sem corpo não tem o que comprimir.** Testando por dentro do host, os
hosts protegidos pelo Authelia devolvem `302` para o portal e os que têm login
próprio também redirecionam. Redirect não carrega corpo, então o
`Content-Encoding` não aparece, e isso **não** é falha. Para provar que o site
comprime, peça uma URL que devolva página de verdade.

Outro engano fácil: `curl` direto na `localhost:8080` com `Host:` mas **sem** os
`X-Forwarded-*` faz o Authelia responder `400 Bad Request`. Não é o site
quebrado, é o forward-auth recusando requisição malformada. Com
`-H 'X-Forwarded-Proto: https' -H 'X-Forwarded-Host: app.dominio' -H 'X-Forwarded-Uri: /'`
o mesmo pedido vira o `302` esperado.

### Detalhes que economizam depuração

- **`encode` no bloco global vale para todos os sites.** Repetir dentro de cada
  `http://app.dominio { }` só é preciso se aquele site quiser política diferente.
- **Atrás do Cloudflare Tunnel a compressão do Caddy continua valendo**, e é ela
  que decide o tamanho no trecho `cloudflared` para `caddy`. A borda do
  Cloudflare pode recomprimir, mas isso não substitui: o salto interno paga
  igual.
- **Server-Sent Events e streaming**: comprimir pode atrasar o primeiro byte. Se
  um app usar SSE, restrinja com `encode { match { not path /eventos* } }`.
- **Arquivo já comprimido em disco** (`.br`, `.gz` pré-gerados): use
  `precompressed zstd br gzip` no `file_server`, senão o Caddy comprime de novo
  a cada requisição.

## Troubleshooting

| Sintoma                                | Causa provável                                           | Correção                                                                                             |
| :------------------------------------- | :------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| Loop de redirect no login              | Caddy mandando `X-Forwarded-Proto: http` ao Authelia     | O bloco global já tem `trusted_proxies static private_ranges`; confirme que o Cloudflare força HTTPS |
| `502 Bad Gateway` num app              | App fora da rede `caddy-net` ou nome de container errado | Ponha o app na `caddy-net`; o `reverse_proxy` usa o `container_name` exato                           |
| `network caddy-net/auth-net not found` | Rede externa não criada                                  | `docker network create caddy-net` / `auth-net` antes do deploy                                       |
| UI do lldap abre sem pedir login       | Faltou `import authelia` no bloco `users.`               | Adicione `import authelia` e recarregue                                                              |
| Mudou o Caddyfile e não aplicou        | Precisa reler o arquivo                                  | `docker restart caddy` (o `caddy reload` falha: `admin off` desliga a API `:2019`)                   |

## Notas Importantes

- O Caddy é **infra compartilhada**: um só para todos os apps. Não crie um por projeto.
- `admin off` no Caddyfile: sem API de admin exposta dentro do container.
- Precisa de Caddy **v2.7+** (o `private_ranges`/`trusted_proxies_strict`); a tag `caddy:2-alpine` atende e é multi-arch (roda em x86_64 e ARM).

## Acessos

| O quê                  | Onde                         |
| :--------------------- | :--------------------------- |
| Portal de login        | `https://auth.selflabs.org`  |
| UI de usuários (lldap) | `https://users.selflabs.org` |
| App exemplo            | `https://pdf.selflabs.org`   |
| Porta local (só host)  | `127.0.0.1:8080`             |

## Referências

- [Caddy — `forward_auth`](https://caddyserver.com/docs/caddyfile/directives/forward_auth)
- [Authelia — Caddy integration](https://www.authelia.com/integration/proxies/caddy/)
- [Authelia + lldap (este repo)](./authelia.md)
