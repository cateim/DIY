# 🛰️ Portainer Agent (outra máquina no Portainer central)

Liga uma máquina com Docker ao Portainer que já roda no homelab, sem instalar um segundo Portainer nela. Na máquina fica só o `portainer/agent`, um container sem estado: usuários, stacks, variáveis de ambiente e o clone dos repositórios continuam no servidor. Quem abre a conexão é o servidor, então console, exec e logs ao vivo funcionam, diferente do Edge Agent Async, que só manda snapshot.

Exemplo real deste guia: o notebook `alienware` (Omarchy) ligado ao `portainer.selflabs.org` (Portainer EE 2.45.3 do Orange Pi 5) pelo Tailscale, em 03/11/2026. A VPS Oracle, que até 19/11/2026 era um Edge Agent Async com o snapshot parado havia uns 59 dias, virou Agent também, por um caminho próprio, porque lá o Tailscale roda em container (Parte 6).

**Pré-requisito:** Docker na máquina ([Parte 1 do guia do Portainer no Debian](./portainer-debian.md#parte-1-instalação-do-docker-engine); o Omarchy já vem com ele) e [Tailscale](./tailscale.md) nas duas pontas.

Não há stack: o agent é o que liga a máquina ao Portainer, então ele sobe com `docker run`, fora do Portainer.

> ℹ️ **Agent ou Edge Agent?**
>
> |                              | Agent (este guia)                                  | Edge Agent Async                          |
> | :--------------------------- | :------------------------------------------------- | :---------------------------------------- |
> | Quem abre a conexão          | O servidor liga para a máquina na porta `9001`     | A máquina liga para o servidor            |
> | Console, exec e logs ao vivo | Sim                                                | Não (chegam por snapshot)                 |
> | Quando usar                  | O servidor alcança a máquina (casa ou Tailscale)   | O servidor não alcança a máquina          |

---

## Parte 1: Subir o agent na máquina

Copie o comando do próprio Portainer, que já vem com a tag da versão do servidor (agent e servidor precisam estar na mesma versão): **Environment-related** → **Environments** → **Add environment** → **Docker Standalone** → em **More options**, **Agent**.

Na máquina, com `sudo`:

```bash
sudo docker run -d \
  -p 9001:9001 \
  --name portainer_agent \
  --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker/volumes:/var/lib/docker/volumes \
  -v /:/host \
  portainer/agent:2.45.3
```

Confira que subiu: `ss -ltn | grep 9001` mostra `0.0.0.0:9001`.

> ℹ️ O container fica na rede `bridge` padrão, sem rede com nome, e não cria nenhuma `<stack>_default`. O `--restart=always` é o do comando oficial.

> ⚠️ **No Omarchy, ligue o Docker no boot:** `sudo systemctl enable docker.service`. O Omarchy liga só o `docker.socket`, e o Docker só sobe no primeiro uso. Até lá, o `--restart=always` não tem quem o cumpra, e a máquina fica offline no Portainer central depois de cada boot. O drop-in `no-block-boot.conf` do pacote `omarchy-settings` (`DefaultDependencies=no`) deixa o boot seguir sem esperar o Docker. Confira com `systemctl is-enabled docker.service`, que deve responder `enabled`.

---

## Parte 2: Firewall (ufw + ufw-docker do Omarchy)

O Omarchy vem com `ufw` (entrada bloqueada por padrão) e `ufw-docker`. Para uma porta publicada por container, quem decide é o bloco do `ufw-docker` em `/etc/ufw/after.rules`, e ele:

- **libera qualquer origem de rede privada** (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`): da rede de casa o agent responde sem regra nenhuma, mas da rede do trabalho ou de um hotel também;
- **bloqueia o Tailscale**: `100.64.0.0/10` não está nessa lista.

O agent dá controle total do Docker (e, com `/:/host`, do disco inteiro) a quem se conectar nele. Libere só o IP do servidor no Tailscale e feche o resto, **nesta ordem**:

```bash
sudo ufw route allow proto tcp from 100.121.247.120 to any port 9001 comment 'portainer-agent: homelab via tailscale'
sudo ufw route deny proto tcp from any to any port 9001 comment 'portainer-agent: resto'
```

`100.121.247.120` é o IP do Orange Pi 5 no Tailscale (`tailscale ip -4` no servidor).

> ⚠️ **A ordem importa.** Vale a primeira regra que casa. Um `allow` adicionado depois do `deny` nunca é lido, e o Portainer responde `context deadline exceeded` (veja o Troubleshooting). Confira sem `sudo`: `grep -n 9001 /etc/ufw/user.rules` tem que mostrar a linha `ACCEPT` antes da linha `DROP`.

Teste pelo servidor:

```bash
timeout 5 bash -c "</dev/tcp/100.84.113.90/9001" && echo abre || echo fechada   # pelo Tailscale: tem que abrir
timeout 5 bash -c "</dev/tcp/192.168.68.2/9001" && echo abre || echo fechada    # pela rede de casa: tem que ficar fechada
```

---

## Parte 3: Cadastrar no Portainer central

No mesmo wizard da Parte 1:

1. **Name:** `alienware`.
2. **Environment URL:** `100.84.113.90:9001`, o IP da máquina no Tailscale (`tailscale ip -4` nela).
3. **More settings:** grupo `Self-Labs`, tag `selflabs`.
4. **Connect**.

Com o IP do Tailscale, o ambiente fica conectado em qualquer rede onde o Tailscale funcione (casa, 4G, hotel). Em casa o Tailscale vai direto pela rede local (o `tailscale ping` do servidor respondeu em 3 ms via `192.168.68.2`), então não custa nada. Use o IP e não o nome `*.ts.net`, para não depender do DNS dentro do container do Portainer.

> ℹ️ O Portainer do servidor roda na rede `bridge` e chega ao `100.x` pelo `tailscale0` do host. Conferido em 03/11/2026.

---

## Parte 4: Como fica o `/srv`

```
máquina (alienware)                    servidor (orangepi5)
/srv/                                  /srv/portainer/
└── <projeto>/   dados de cada stack   ├── portainer.db        stacks, variáveis, ambientes
                 que roda na máquina   ├── compose/<id>/       compose e clone do repo de cada stack
                                       └── scheduled-backups/  backups agendados do Portainer
```

1. **O agent não tem pasta.** Não existe `/srv/portainer` na máquina.
2. **O compose fica no servidor, mas os bind mounts valem na máquina** onde o container roda: `/srv/<projeto>:/data` usa a pasta da máquina. Crie antes, como nas outras stacks: `sudo mkdir -p /srv/<projeto>` (sem isso, o Docker cria como `root`).
3. **Caminho relativo (`./data`) não funciona**: ele não aponta para uma pasta da máquina, porque o compose está no servidor. Use só caminho absoluto em `/srv/<projeto>`.
4. **O backup do servidor cobre só o Portainer** (stacks, variáveis, ambientes). O `/srv/<projeto>` da máquina não entra nele.

---

## Parte 5: Atualizar o agent

A tag do agent acompanha a do servidor. O homelab usa `portainer-ee:latest`, então, quando ele atualiza, o agent fica para trás. O Portainer não atualiza um agent comum, e o agent não consegue se recriar pelo próprio Portainer, porque a conexão cai no meio. É passo manual, na máquina, pelo procedimento oficial:

```bash
sudo docker stop portainer_agent
sudo docker rm portainer_agent
sudo docker pull portainer/agent:<versão do servidor>
```

Depois rode o `docker run` da Parte 1 com a tag nova. A versão do servidor sai de `curl -sk https://localhost:9443/api/status`, rodado no servidor. As regras do firewall continuam valendo: elas são pela porta, não pelo container.

Na VPS (Parte 6) é o mesmo procedimento, com o `docker run` da Parte 6: a tag nova, `--network portainer-agent-net` e nenhum `-p`. O `serve.json` aponta para o nome do container, então nada muda no `tailscale`.

---

## Parte 6: VPS com Tailscale em container (userspace)

Caso real: a VPS Oracle (node `selflabs`, `100.100.101.83` no Tailscale) ligada ao Portainer do homelab em 19/11/2026. Lá o Tailscale é o container `tailscale` da [stack do guia do Tailscale](./tailscale.md), em modo userspace (`TS_USERSPACE=true`): o host não tem `tailscale0`, então a receita das Partes 1 e 2 não serve.

- **Sem `-p 9001`.** Uma porta publicada não aparece no Tailscale (não existe `tailscale0` no host para recebê-la) e, publicada pelo Docker, passa por cima do `REJECT` do iptables do host e fica aberta para a internet.
- **Sem `ss -ltn` e sem ufw.** Nada é publicado no host, então a conferência da Parte 1 e a Parte 2 inteira não se aplicam. O iptables do host fica como está.
- **Quem leva a porta `9001` à tailnet é o `tailscale`**, com um `TCPForward` no `serve.json` para `portainer_agent:9001`, por uma rede só dos dois.

> ⚠️ **Rede própria, não a `caddy-net`.** Na `caddy-net` vivem `radar-backend`, `alferes-app`, `bentopdf` e `cortendesk`, e todos alcançariam o agent, que é root no host (`/:/host`). Na `portainer-agent-net` ficam só o agent e o `tailscale`.

Na VPS, com `sudo`, nesta ordem:

1. **A rede** (a stack `tailscale` a declara como `external`, então ela vem antes):

   ```bash
   sudo docker network create --driver bridge portainer-agent-net
   ```

2. **O agent**, sem `-p`, na tag da versão do servidor (`curl -sk https://localhost:9443/api/status` no servidor):

   ```bash
   sudo docker run -d \
     --name portainer_agent \
     --restart=always \
     --network portainer-agent-net \
     -e TZ=America/Sao_Paulo \
     -v /var/run/docker.sock:/var/run/docker.sock \
     -v /var/lib/docker/volumes:/var/lib/docker/volumes \
     -v /:/host \
     portainer/agent:2.45.4
   ```

3. **O `tailscale` entra na `portainer-agent-net`.** Está em [`assets/stacks/tailscale.yml`](../assets/stacks/tailscale.yml), na lista `networks` do serviço e como rede externa; redeploy da stack pelo Portainer da VPS. Sem recriar o container, dá para ligar na hora com `sudo docker network connect portainer-agent-net tailscale`.

4. **O `serve.json` ganha a porta `9001`** em `/srv/tailscale/config/serve.json` (espelho em [`assets/configs/tailscale-serve.json`](../assets/configs/tailscale-serve.json)), dentro de `"TCP"`:

   ```json
   "9001": { "TCPForward": "portainer_agent:9001" }
   ```

   Guarde uma cópia antes (`sudo cp serve.json serve.json.bak-AAAAMMDD`). O container aplica a mudança sozinho em segundos (log `serve proxy: applying serve config`), sem restart.

Teste pelo servidor (Orange Pi 5):

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://100.100.101.83:9001/ping   # tem que responder 204
```

5. **Só o servidor alcança a `9001`: a regra fica no ACL do Tailscale.** Sem ufw na frente, o `serve` abre a porta para qualquer aparelho que o ACL deixe chegar ao `selflabs`, e o padrão _allow-all_ deixa todos. No policy file (Access controls), troque o grant `*` → `*` por estes:

   ```hujson
   "hosts": {"orangepi5": "100.121.247.120", "alienware": "100.84.113.90"},
   "grants": [
     {"src": ["autogroup:member"], "dst": ["autogroup:member"], "ip": ["*"]},
     {"src": ["autogroup:member"], "dst": ["192.168.68.0/24"], "ip": ["*"]},
     {"src": ["autogroup:member"], "dst": ["tag:server"], "ip": ["tcp:443"]},
     {"src": ["orangepi5"], "dst": ["tag:server"], "ip": ["tcp:9001"]},
   ],
   "tests": [
     {"src": "orangepi5", "accept": ["tag:server:9001", "tag:server:443"]},
     {"src": "alienware", "accept": ["tag:server:443"], "deny": ["tag:server:9001"]},
   ],
   ```

   O ACL só tem _allow_, por isso o `*` sai e entram regras explícitas: os aparelhos pessoais seguem livres entre si, todos abrem o Portainer da VPS na `443`, e a `9001` aceita só o Orange Pi. Os `tests` impedem salvar uma versão que reabra a porta. Conferido em 19/11/2026: do notebook a `9001` fecha e a `443` abre; do Orange Pi o `/ping` dá 204. Com isso o `AGENT_SECRET` não é necessário: quem alcança o agent é o mesmo Orange Pi que já roda o Portainer.

### Cadastrar no Portainer do homelab

> ⚠️ **A licença EE do homelab aceita só 3 ambientes.** Um 4º responde HTTP 402 (`exceeded the node allowance`). Apague o ambiente antigo da máquina **antes** de cadastrar o novo.

1. **Environments** → o ambiente Edge antigo (`oracle`) → **Remove**.
2. Wizard da Parte 1 → **Docker Standalone** → **Agent**.
3. **Name:** `oracle`. **Environment URL:** `100.100.101.83:9001`. **More settings:** grupo `Self-Labs`, tag `selflabs`.
4. **Connect**. Em 19/11/2026 o ambiente novo listou os 37 containers e mostrou os logs do `caddy` ao vivo.
5. Na VPS, pare e remova o container antigo do Edge Agent (`portainer_edge_agent`). O volume dele (`portainer_agent_data`) só tem a identidade do Edge e não serve ao agent novo: apague com `sudo docker volume rm portainer_agent_data` (feito em 19/11/2026).

> ℹ️ **As stacks continuam no Portainer da VPS.** O Portainer próprio da VPS (container `portainer`, alcançado pela tailnet e pelo Caddy) segue dono das stacks com GitOps (`authelia`, `caddy`, `tailscale`, `radar`...). No homelab elas aparecem como externas, com acesso limitado: ver, console e logs por ali; editar e redeploy só no Portainer da VPS, nunca pelo homelab. Dois donos de GitOps na mesma stack brigam entre si.

---

## Troubleshooting

| Sintoma                                                             | Causa                                                                                     | Correção                                                                                                                                                                                                                  |
| :------------------------------------------------------------------ | :---------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Get "https://100.84.113.90:9001/ping": context deadline exceeded` | O `allow` do Tailscale ficou depois do `deny`, ou não existe (Parte 2)                    | `sudo ufw route delete allow proto tcp from 100.121.247.120 to any port 9001`, depois `sudo ufw route insert 1 allow proto tcp from 100.121.247.120 to any port 9001 comment 'portainer-agent: homelab via tailscale'` |
| Abre pela rede de casa, mas não pelo Tailscale                      | Sem regra própria, o `ufw-docker` libera só redes privadas                                | Regra `allow` da Parte 2                                                                                                                                                                                                  |
| Abre de qualquer rede privada                                       | Falta o `deny` da Parte 2                                                                 | Regra `deny` da Parte 2                                                                                                                                                                                                   |
| Ambiente offline fora de casa                                       | A rede bloqueia o Tailscale (o Squid do trabalho bloqueia), ou a máquina está dormindo   | Esperado: os containers continuam rodando, e o Portainer volta a alcançar a máquina quando o Tailscale reconecta                                                                                                         |
| Recursos falhando depois de atualizar o servidor                    | Agent numa versão diferente da do servidor                                                | Parte 5                                                                                                                                                                                                                   |
| HTTP 402 `exceeded the node allowance` ao cadastrar                 | A licença EE do homelab já tem os 3 ambientes que aceita                                  | Apague o ambiente antigo da máquina antes de cadastrar o novo (Parte 6)                                                                                                                                                   |
| `/ping` da VPS não responde (`100.100.101.83:9001` fechada)         | Falta o `TCPForward` da `9001` no `serve.json`, ou o `tailscale` fora da `portainer-agent-net` | Confira `/srv/tailscale/config/serve.json` e `sudo docker network inspect portainer-agent-net` (os dois containers na lista); `sudo docker restart tailscale` se o log não mostrar `applying serve config` |

---

## Notas Importantes

- **O agent não guarda nada.** Recriar o container não perde configuração: tudo está no servidor.
- **Máquina fora do alcance é deploy parado.** O webhook GitOps das stacks dessa máquina só aplica quando o Portainer consegue chegar nela.
- **No `alienware`, a VM Windows do Omarchy aparece na lista**: um container com QEMU nas portas `3389` e `8006`, presas em `127.0.0.1`. Não recrie nem apague por ali.

---

## Acessos

| Recurso                         | URL / Local                                       |
| :------------------------------ | :------------------------------------------------ |
| **Painel**                      | `https://portainer.selflabs.org`                  |
| **Ambiente**                    | `alienware` (grupo `Self-Labs`, tag `selflabs`)   |
| **Agent**                       | `100.84.113.90:9001` (Tailscale do notebook)      |
| **Ambiente da VPS**             | `oracle` (grupo `Self-Labs`, tag `selflabs`)      |
| **Agent da VPS**                | `100.100.101.83:9001` (serve TCP do container `tailscale`) |
| **Origem liberada no firewall** | `100.121.247.120` (Tailscale do Orange Pi 5)      |
| **Regras do firewall**          | `/etc/ufw/user.rules` (linhas com `9001`)         |
| **Dados das stacks**            | `/srv/<projeto>` na máquina                       |
| **Compose e clones**            | `/srv/portainer/compose/<id>` no servidor         |

---

## Referências

- [Portainer: instalar o Agent no Docker Standalone](https://docs.portainer.io/admin/environments/add/docker/agent)
- [Portainer: atualizar o Agent no Docker](https://docs.portainer.io/start/upgrade/docker)
- [ufw-docker (regras do Docker no ufw)](https://github.com/chaifeng/ufw-docker)
- [Docker + Portainer no Debian](./portainer-debian.md) · [Tailscale](./tailscale.md)
