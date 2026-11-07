# 🛰️ Portainer Agent (outra máquina no Portainer central)

Liga uma máquina com Docker ao Portainer que já roda no homelab, sem instalar um segundo Portainer nela. Na máquina fica só o `portainer/agent`, um container sem estado: usuários, stacks, variáveis de ambiente e o clone dos repositórios continuam no servidor. Quem abre a conexão é o servidor, então console, exec e logs ao vivo funcionam, diferente do Edge Agent Async (o caso da VPS Oracle).

Exemplo real deste guia: o notebook `alienware` (Omarchy) ligado ao `portainer.selflabs.org` (Portainer EE 2.45.3 do Orange Pi 5) pelo Tailscale, em 03/11/2026.

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

---

## Troubleshooting

| Sintoma                                                             | Causa                                                                                     | Correção                                                                                                                                                                                                                  |
| :------------------------------------------------------------------ | :---------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Get "https://100.84.113.90:9001/ping": context deadline exceeded` | O `allow` do Tailscale ficou depois do `deny`, ou não existe (Parte 2)                    | `sudo ufw route delete allow proto tcp from 100.121.247.120 to any port 9001`, depois `sudo ufw route insert 1 allow proto tcp from 100.121.247.120 to any port 9001 comment 'portainer-agent: homelab via tailscale'` |
| Abre pela rede de casa, mas não pelo Tailscale                      | Sem regra própria, o `ufw-docker` libera só redes privadas                                | Regra `allow` da Parte 2                                                                                                                                                                                                  |
| Abre de qualquer rede privada                                       | Falta o `deny` da Parte 2                                                                 | Regra `deny` da Parte 2                                                                                                                                                                                                   |
| Ambiente offline fora de casa                                       | A rede bloqueia o Tailscale (o Squid do trabalho bloqueia), ou a máquina está dormindo   | Esperado: os containers continuam rodando, e o Portainer volta a alcançar a máquina quando o Tailscale reconecta                                                                                                         |
| Recursos falhando depois de atualizar o servidor                    | Agent numa versão diferente da do servidor                                                | Parte 5                                                                                                                                                                                                                   |

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
