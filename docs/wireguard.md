# 🔒 WireGuard em container (a única porta de um banco legado)

Põe um banco que não pode ficar exposto atrás de um WireGuard que roda como segundo container da mesma stack. O banco não publica porta nenhuma no host: a única porta aberta da VPS é a UDP do WireGuard, e o firewall do próprio container deixa cada PC alcançar só o banco, nem o host nem a internet. Cada PC entra por uma variável do Portainer e ganha chave própria e um `.conf` pronto para o WireGuard for Windows.

Exemplo real deste guia: o Firebird 3.0 de um ERP que saiu de um servidor Windows local para uma VPS Oracle (Ampere A1, arm64), em 11/2026. Um dos apps traz cliente Firebird 2.5, que só entra com auth legada e sem criptografia de fio, então o túnel é a única proteção do tráfego. **Os dados aqui são de exemplo:** nome da stack, IP público (faixa de documentação `203.0.113.0/24`) e nomes dos PCs.

**Pré-requisito:** Docker + Portainer ([Docker + Portainer no Debian](./portainer-debian.md)) numa VPS com IP público ([VPS Oracle](./vps-oracle.md)), com o módulo WireGuard no kernel (todo Linux 5.6 ou mais novo; o Ubuntu da Oracle já traz).

A stack pronta está em [`assets/stacks/wireguard.yml`](../assets/stacks/wireguard.yml); a imagem do WireGuard, em [`assets/configs/wireguard-Dockerfile`](../assets/configs/wireguard-Dockerfile) e [`assets/configs/wireguard-entrypoint.sh`](../assets/configs/wireguard-entrypoint.sh).

> ℹ️ **Por que um container nosso, e não o WireGuard no host nem a imagem da linuxserver?**
>
> |                      | Container na stack (este guia)   | `wg-quick` no host                                                            | `linuxserver/wireguard`                                              |
> | :------------------- | :------------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------- |
> | Onde fica a config   | No repo da stack (GitOps)        | No host, à mão, repetida em cada VPS                                          | Variáveis + template no volume                                       |
> | Ordem de subida      | Não importa: nada preso ao túnel | O Docker tem que esperar o `wg0`, senão o bind no IP do túnel falha no reboot | Não importa                                                          |
> | O que o PC alcança   | Só o banco                       | O que o firewall do host deixar                                               | Tudo que o container alcança (host, internet), até editar o template |
> | Chave dos PCs no log | Nunca                            | Não se aplica                                                                 | Sim, por padrão (`LOG_CONFS`)                                        |

---

## Parte 1: Desenho da rede

```
PC (WireGuard for Windows)          VPS (Docker)
10.77.0.10 ---- UDP 51820 ---->  [wireguard]  wg0 10.77.0.1
                                      |  NAT, só para o banco
                                      v
                                 [firebird]   10.77.1.10:3050
                                 rede banco-legado-net, 10.77.1.0/24
```

- **Túnel `10.77.0.0/24`:** a VPS é o `.1`; cada PC é `10.77.0.<final>`, com o final que você der na lista.
- **Rede da stack com sub-rede fixa `10.77.1.0/24`:** o banco fica no IP fixo `10.77.1.10`, e os IPs automáticos ficam no `.128/25`, longe dele.
- **Escolha faixas que não colidam** com a LAN do escritório nem com a casa dos usuários remotos. `192.168.x` é o comum em roteador doméstico, por isso o exemplo usa `10.77`.
- **No PC, só o banco entra no túnel** (`10.77.1.10/32`, mais o `10.77.0.1/32` para o ping de teste). A internet e a rede local do PC não mudam.
- **O `.conf` do PC não tem linha `DNS`, de propósito:** com túnel parcial, um DNS que só existe do outro lado quebraria a resolução de nomes do PC inteiro.
- **O banco vê todo PC com o IP do container `wireguard`** (NAT). Para saber qual PC é qual, use o nome da máquina (no Firebird, `MON$REMOTE_HOST` em `MON$ATTACHMENTS`).

---

## Parte 2: Preparar a VPS

1. Pastas da stack. A das chaves, só o `root` lê (sem o `install -m 700`, o Docker cria com `755`):

   ```bash
   sudo install -d -m 700 /srv/banco-legado/wireguard
   sudo mkdir -p /srv/banco-legado/data
   ```

2. Confira o módulo do kernel. Não precisa instalar `wireguard-tools` no host:

   ```bash
   modinfo -F version wireguard   # ex.: 1.0.0
   ```

   O container conta com o kernel carregando o módulo sozinho quando cria o `wg0`. Se o log do container disser `Unknown device type`, carregue no boot:

   ```bash
   echo wireguard | sudo tee /etc/modules-load.d/wireguard.conf
   sudo modprobe wireguard
   ```

---

## Parte 3: Liberar a porta na Oracle Cloud

Na Security List (ou NSG) da subnet da VPS, **Add Ingress Rules**:

| Campo                  | Valor       |
| :--------------------- | :---------- |
| Source CIDR            | `0.0.0.0/0` |
| IP Protocol            | `UDP`       |
| Destination Port Range | `51820`     |

Os usuários remotos chegam de qualquer IP (casa, 4G), por isso `0.0.0.0/0`. O WireGuard não responde a pacote sem chave válida: para um scanner, a porta parece fechada. Se todo mundo saísse de um IP fixo, restrinja a origem a ele.

> ℹ️ O `iptables` do Ubuntu da Oracle (`REJECT` no fim do `INPUT`) não atrapalha: porta publicada pelo Docker passa pelo `FORWARD` (DNAT para o container), não pelo `INPUT`. Nenhuma porta TCP do banco é aberta, nem na Oracle nem no host.

---

## Parte 4: Repositório da stack e deploy no Portainer

Esta stack builda duas imagens (o banco e o WireGuard), então vai pelo método **Repository**, não pelo Web editor: o Portainer clona o repo e builda a partir dele. Monte o repo assim:

```
banco-legado/
|-- docker-compose.yml          # assets/stacks/wireguard.yml
|-- Dockerfile                  # a imagem do seu banco
`-- docker/wireguard/
    |-- Dockerfile              # assets/configs/wireguard-Dockerfile
    `-- entrypoint.sh           # assets/configs/wireguard-entrypoint.sh
```

1. Portainer → **Stacks** → **Add stack**.
2. **Nome:** `banco-legado`. **Build method:** **Repository**.
3. Repository URL do repo da stack, reference `refs/heads/master`, Compose path `docker-compose.yml`, autenticação com Personal Access Token.
4. **Create a Webhook** e **Force redeployment** ligados. **Re-pull image** desligado: as duas imagens só existem nesta VPS (`pull_policy: build`), não há o que puxar.
5. Em **Environment variables**:

   | Variável      | Exemplo                   | Para quê                                                 |
   | :------------ | :------------------------ | :------------------------------------------------------- |
   | `WG_ENDPOINT` | `203.0.113.10`            | IP público (ou DNS) da VPS; vai no `.conf` de cada PC    |
   | `WG_PEERS`    | `pc-01:10,note-remoto:11` | `nome:final` por vírgula; o `pc-01` fica em `10.77.0.10` |
   | `WG_PORT`     | `51820`                   | Porta UDP no host (opcional)                             |

6. **Deploy the stack**. No GitHub, cole a Webhook URL da stack em **Settings** → **Webhooks**: cada `git push` no `master` rebuilda e sobe de novo.

> ⚠️ **`pull_policy: build` não pode sair do compose.** Sem ele, o redeploy do webhook reusa a imagem que já existe, e uma mudança no `entrypoint.sh` nunca chega ao container.

---

## Parte 5: O que o entrypoint faz em cada subida

1. **Valida tudo antes de mexer em qualquer coisa:** `WG_ENDPOINT` (só o host, sem porta), `WG_PORT`, `FB_IP` e cada item de `WG_PEERS` (nome com `a-z`, `0-9` e `-`; final de 2 a 254; sem nome nem final repetido). Config errada para o container antes de criar arquivo de chave ou meio túnel.
2. **Chaves:** gera uma vez a do servidor e, por PC, uma chave e uma PSK, em `/srv/banco-legado/wireguard` (arquivos `600`, pasta `peers/` `700`). Nas subidas seguintes, reusa as mesmas.
3. **`.conf` de cada PC** em `peers/<nome>.conf`, reescrito a cada subida: se o IP público mudar, basta redeployar e entregar de novo.
4. **Firewall do túnel**, dentro do netns do container, **antes de o `wg0` existir**: o netns novo nasce com o `FORWARD` em `ACCEPT` e o compose já ligou o `ip_forward`, então um `wg0` no ar antes das regras deixaria um PC passar para qualquer lugar por alguns milissegundos. As regras casam o `wg0` pelo nome e valem desde o primeiro pacote:

   ```bash
   iptables -P FORWARD DROP
   iptables -t filter -A FORWARD -i wg0 -d 10.77.1.10 -p tcp -j ACCEPT
   iptables -t filter -A FORWARD -i wg0 -d 10.77.1.10 -p icmp -j ACCEPT
   iptables -t filter -A FORWARD -o wg0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
   iptables -t nat -A POSTROUTING -s 10.77.0.0/24 -d 10.77.1.10 -j MASQUERADE
   iptables -t filter -A INPUT -i wg0 -p icmp -j ACCEPT
   iptables -t filter -A INPUT -i wg0 -j DROP
   ```

   Qualquer porta TCP do banco passa, não só a `3050`: o cliente Firebird 2.5 abre uma segunda conexão, numa porta aleatória, para os eventos. No container do banco só o Firebird escuta fora do loopback (o DNS embutido do Docker fica em `127.0.0.11`, que o túnel não alcança).

5. **`wg0`** com `10.77.0.1/24`, pelo módulo do kernel.

> ⚠️ **Nunca `iptables -F` nesse container.** O Docker grava no `nat` do próprio container as regras do DNS embutido (`127.0.0.11`); um flush quebra a resolução de nomes. O entrypoint adiciona cada regra com `-C || -A`, então rodar de novo não duplica nada.

Nenhuma chave privada vai para o log. Ele mostra os PCs e a chave pública do servidor:

```
[wireguard] peer pc-01: 10.77.0.10 (config em /config/peers/pc-01.conf)
[wireguard] tunel no ar: 10.77.0.1/24, UDP 51820 (no host: 51820), 1 peer(s).
```

---

## Parte 6: Adicionar, entregar e tirar um PC

1. **Adicionar:** acrescente `nome:final` ao `WG_PEERS` no Portainer e clique em **Update the stack**. As chaves de quem já estava na lista não mudam.
2. **Entregar:** o `.conf` tem a chave privada do PC. Baixe para fora de pasta sincronizada (nada de `~/Drive`), mande pelo RustDesk e apague a cópia:

   ```bash
   ssh vps-exemplo 'sudo cat /srv/banco-legado/wireguard/peers/pc-01.conf' > ~/pc-01.conf
   ```

   No PC: instale o [WireGuard for Windows](https://www.wireguard.com/install/), **Importar túnel de arquivo** e **Ativar**. O `.conf` gerado:

   ```ini
   [Interface]
   PrivateKey = <chave privada do pc-01>
   Address = 10.77.0.10/32

   [Peer]
   PublicKey = <chave pública da VPS>
   PresharedKey = <psk do pc-01>
   Endpoint = 203.0.113.10:51820
   AllowedIPs = 10.77.1.10/32, 10.77.0.1/32
   PersistentKeepalive = 25
   ```

   O `PersistentKeepalive` segura o NAT do roteador do escritório: sem ele, uma conexão do app parada por minutos perde o caminho de volta.

3. **Tirar:** remova o nome do `WG_PEERS` e **Update the stack**: o PC perde o acesso na hora. Os arquivos dele ficam em `peers/`, e pôr o mesmo nome de volta devolve a mesma chave. Para PC perdido ou roubado, apague `<nome>.key`, `<nome>.psk` e `<nome>.conf` antes de reusar o nome.

---

## Parte 7: Testar

Na VPS:

```bash
docker exec banco-legado-wireguard wg show      # "latest handshake" de cada PC ativo
docker logs --tail 20 banco-legado-wireguard
```

No PC (PowerShell):

```powershell
ping 10.77.0.1                                  # o túnel
Test-NetConnection 10.77.1.10 -Port 3050        # o banco: TcpTestSucceeded : True
```

Nos apps, o banco passa a ser host `10.77.1.10`, porta `3050` (no Firebird: `10.77.1.10/3050:<alias>`).

---

## Parte 8: Atualizar e backup

- **Atualizar:** `git push` no repo da stack, e o webhook rebuilda. O build usa cache: pacote novo do Debian só entra quando o `Dockerfile` muda, ou num build sem cache pela VPS (`docker compose build --no-cache`, via SSH, como plano B).
- **Backup:** `/srv/banco-legado/wireguard` entra no backup da VPS, criptografado. Perder essa pasta não derruba o banco, mas todo PC precisa de `.conf` novo.

---

## Troubleshooting

| Sintoma                                                                                                                 | Causa                                                     | Correção                                                                                       |
| :---------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `Unknown device type` no log do `wireguard`                                                                             | O kernel não carregou o módulo sozinho                    | Parte 2, passo 2                                                                               |
| `ERRO: peer invalido em WG_PEERS` e o container reiniciando                                                             | Nome com maiúscula, final fora de 2 a 254, ou repetido    | Corrigir o `WG_PEERS` e **Update the stack**                                                   |
| Deploy falha com `user specified IP address is supported only when connecting to networks with user configured subnets` | A rede da stack já existia sem sub-rede fixa              | Parar a stack, `sudo docker network rm banco-legado-net`, redeployar                           |
| PC sem `latest handshake`                                                                                               | UDP fechada na Security List, ou `WG_ENDPOINT` errado     | Parte 3; conferir o `Endpoint` do `.conf`                                                      |
| Handshake ok, mas a porta do banco não abre                                                                             | Banco ouvindo só em `localhost`, ou fora do IP fixo       | No Firebird, `RemoteBindAddress = 0.0.0.0`; `docker inspect banco-legado-firebird` mostra o IP |
| A internet do PC parou com o túnel ativo                                                                                | `.conf` editado com `AllowedIPs = 0.0.0.0/0` ou com `DNS` | Usar o `.conf` gerado                                                                          |
| A conexão do app cai depois de minutos parada                                                                           | O NAT do roteador fechou o mapeamento UDP                 | `PersistentKeepalive = 25` (já vem no `.conf`)                                                 |

---

## Notas Importantes

- **O banco não tem porta no host.** Não existe bind para publicar errado em `0.0.0.0`: a única porta exposta é a UDP do WireGuard.
- **O `.conf` é segredo.** Tem a chave privada do PC: nunca por e-mail, chat ou pasta sincronizada.
- **IP público estável.** Em produção, use IP reservado da Oracle ou um DNS: se o IP mudar, todo PC precisa de `.conf` novo (o WireGuard for Windows resolve o nome só ao ativar o túnel).
- **O healthcheck pede só `listen-port`.** O `wg show` completo gravaria o IP de casa de cada PC no estado do container, visível no Portainer.
- **Trocar a sub-rede depois exige recriar a rede** (veja o Troubleshooting).

---

## Acessos

| Recurso              | Local                                               |
| :------------------- | :-------------------------------------------------- |
| **Porta pública**    | UDP `51820` (`203.0.113.10:51820`)                  |
| **Túnel**            | `10.77.0.0/24` (VPS = `10.77.0.1`)                  |
| **Banco**            | `10.77.1.10:3050`, só pelo túnel                    |
| **Chaves e `.conf`** | `/srv/banco-legado/wireguard` (`peers/<nome>.conf`) |
| **Status**           | `docker exec banco-legado-wireguard wg show`        |

---

## Referências

- [WireGuard: Quick Start](https://www.wireguard.com/quickstart/)
- [WireGuard for Windows](https://www.wireguard.com/install/)
- [wg(8)](https://man7.org/linux/man-pages/man8/wg.8.html)
- [Oracle Cloud: Security Lists](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securitylists.htm)
- [Docker + Portainer no Debian](./portainer-debian.md) · [VPS Oracle](./vps-oracle.md) · [Tailscale](./tailscale.md)
