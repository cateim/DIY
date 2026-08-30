# Guia de Instalação: Docker + Portainer no Debian 13

Este guia mostra os passos para instalar o Docker Engine e Docker Compose. A interface de gerenciamento Portainer será instalada em um servidor Debian 13, centralizando os dados de configuração na pasta `/srv`.

**Nota de Arquitetura:** Este guia é universal e funciona tanto para arquiteturas **x86_64** (Intel/AMD) quanto **ARM** (como Raspberry Pi, Orange Pi, etc.), desde que estejam rodando Debian 13. Os scripts de instalação detectarão automaticamente a arquitetura correta.

## Parte 1: Instalação do Docker Engine

Siga estes passos no terminal do seu servidor Debian.

### 1. Atualizar Pacotes e Instalar Dependências

Vamos garantir que o sistema está atualizado e tem os certificados necessários.

```bash
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg
```

### 2. Adicionar o Repositório Oficial do Docker

Adicionamos a chave GPG e o repositório oficial do Docker. O script detecta sua arquitetura automaticamente.

```bash
# Criar pasta para a chave
sudo install -m 0755 -d /etc/apt/keyrings

# Baixar a chave GPG
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Adicionar o repositório à lista do apt
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

### 3. Instalar o Docker Engine (Mais Recente)

Com o repositório configurado, atualizamos o `apt` e instalamos a versão mais recente do Docker e seus componentes.

```bash
# Atualiza a lista de pacotes após adicionar o repo
sudo apt-get update

# Instala os pacotes
sudo apt-get install \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

# Verifica se o Docker instalou corretamente
sudo docker version
```

> **Nota sobre histórico de bugs:** No passado (ex: com Docker 29.x e Portainer 2.33.3), problemas de incompatibilidade exigiam fixar o Docker em uma versão específica (como a 5.28). Atualmente, a versão mais recente ("latest") funciona sem problemas. Se no futuro um bug similar ocorrer e você precisar fazer o downgrade/travar uma versão, consulte o **Anexo B: Instalar e Travar uma Versão Específica do Docker** no final deste guia.

### 4. (Importante!) Adicionar seu Usuário ao Grupo Docker

Isso permite que você execute comandos do Docker sem precisar usar `sudo` toda vez.

```bash
sudo usermod -aG docker $USER
```

**⚠️ Atenção:** Após rodar este comando, você precisa **reiniciar o servidor** ou **sair e entrar novamente** (fazer logoff/login) para que a mudança tenha efeito.

## Parte 2: Instalação do Portainer

Agora que o Docker está funcionando, vamos instalar o Portainer para gerenciá-lo.

### 1. Criar a Pasta de Dados do Portainer

Seguindo nosso padrão, vamos criar a pasta de configuração dentro de `/srv`.

```bash
sudo mkdir -p /srv/portainer
```

### 2. Iniciar o Container do Portainer

Este comando irá baixar e executar o Portainer. A imagem `portainer/portainer-ce:latest` é multi-arquitetura e funcionará automaticamente.

**Portas mapeadas:**

- `9000:9000` → Interface web via **HTTP**
- `9443:9443` → Interface web via **HTTPS** (certificado autoassinado)
- `8000:8000` → Comunicação com agentes Portainer (Edge Agents)

```bash
sudo docker run -d \
  -p 9000:9000 \
  -p 9443:9443 \
  -p 8000:8000 \
  --name portainer \
  --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/portainer:/data \
  portainer/portainer-ce:latest
```

## Parte 3: Acesso ao Portainer

Após alguns segundos, o Portainer estará no ar e pronto para ser configurado.

1.  Abra seu navegador de internet.
2.  Acesse o endereço: `http://IP_DO_SEU_DEBIAN:9000`
    - (Substitua `IP_DO_SEU_DEBIAN` pelo IP do seu servidor).
3.  Na primeira tela, crie seu usuário administrador e senha.
    - Se preferir acessar via HTTPS, use `https://IP_DO_SEU_DEBIAN:9443`. Nesse caso, o navegador exibirá um aviso de certificado autoassinado, clique em "Avançado" e "Aceitar o risco".
4.  Selecione a opção "Gerenciar o ambiente Docker local" e clique em "Conectar".

Pronto! Seu ambiente Docker e Portainer está 100% operacional. 🚀

## Parte 4 (Opcional): Gerenciar Vários Servidores em um Único Portainer

Se você tem mais de um host com Docker (por exemplo um home-lab em casa e uma VPS na nuvem), dá para gerenciar todos por uma única interface. Um Portainer assume o papel de **servidor central** e os demais hosts recebem apenas um **Edge Agent**, que se conecta de volta ao central.

> ℹ️ **Parte totalmente opcional.** As Partes 1 a 3 já entregam um Portainer completo e funcional para um único servidor. Continue daqui só se quiser centralizar a gestão de vários hosts.

> ⚠️ **O modo Async exige o Portainer Business Edition** (imagem `portainer/portainer-ee`). A licença gratuita da BE cobre até 3 nós. Na Community Edition, apenas o Edge Agent Standard está disponível.

### 1. Escolher o modo: Standard ou Async

Quem inicia a conexão é sempre o **agente**, nunca o servidor central. É isso que define qual modo é viável:

| Critério                              | Edge Agent Standard              | Edge Agent Async              |
| ------------------------------------- | -------------------------------- | ----------------------------- |
| Portas necessárias no central         | UI (`9443`) **e** túnel (`8000`) | apenas a UI (`9443` ou `443`) |
| Passa por Cloudflare Tunnel           | Não, a `8000` é TCP puro         | Sim, usa somente HTTPS        |
| Console e exec nos containers remotos | Sim, em tempo real               | Não                           |
| Logs ao vivo                          | Sim                              | Não, apenas snapshots         |
| Edição do Portainer                   | CE e BE                          | Somente BE                    |

**Regra prática:** se o servidor central está atrás de NAT residencial e é publicado por Cloudflare Tunnel, a porta `8000` nunca será alcançável de fora, então o caminho é o **Async**. Para abrir terminal nos containers remotos, use SSH.

> ℹ️ O papel de central costuma ficar com o host mais estável, mas o requisito técnico é outro: o agente precisa alcançar o central. Uma VPS com IP público é sempre alcançável; um servidor doméstico só é alcançável pelo HTTPS publicado no túnel.

### 2. Habilitar o Edge Compute no servidor central

No Portainer central, vá em **Settings → Edge Compute**:

| Campo                                               | Valor                              |
| --------------------------------------------------- | ---------------------------------- |
| Enable Edge Compute features                        | Ligado                             |
| Portainer API server URL                            | `https://portainer.seudominio.com` |
| Portainer tunnel server address                     | `portainer.seudominio.com:8000`    |
| Async Check-in Intervals (ping, snapshot e command) | `1 minute`                         |

Os três intervalos async vêm como `disabled` e o menor valor disponível é `1 minute`. Cada bloco da página tem o seu próprio botão **Save settings**.

> ℹ️ O campo **tunnel server address** é obrigatório na tela mesmo quando você vai usar o modo Async, que não o utiliza. Preencha e siga adiante. Enquanto o Edge Compute estiver desligado, a seção **Edge compute** nem aparece no menu lateral.

### 3. Criar o ambiente

**Environments → Add environment → Docker Standalone → Start Wizard → Edge Agent Async**.

Informe um nome (ex.: `oracle-vps`) e a mesma **Portainer API server URL**. Ao salvar, o Portainer gera o comando de instalação já com `EDGE_ID` e `EDGE_KEY` preenchidos. Copie a versão da aba **Docker Standalone**.

> ℹ️ O aviso "Edge ID Generator is required" na tela de detalhes do ambiente afeta apenas a geração do script naquela página. Um agente já em execução tem o seu ID definitivo e não é impactado.

### 4. Instalar o agente no servidor remoto

> ⚠️ **Rode o comando no servidor REMOTO, nunca no central.** Colar por engano no terminal do próprio Portainer central sobe um agente apontando para ele mesmo, e o ambiente jamais conecta.

O comando tem esta forma (use sempre o gerado pela sua instalação, com o seu ID e a sua chave):

```bash
docker run -d \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker/volumes:/var/lib/docker/volumes \
  -v /:/host \
  -v portainer_agent_data:/data \
  --restart always \
  -e EDGE=1 \
  -e EDGE_ASYNC=1 \
  -e EDGE_ID=<id-gerado> \
  -e EDGE_KEY=<chave-gerada> \
  -e EDGE_INSECURE_POLL=1 \
  --name portainer_edge_agent \
  portainer/agent:latest
```

Se colou na máquina errada, limpe antes de repetir no host correto:

```bash
docker stop portainer_edge_agent && docker rm portainer_edge_agent
docker volume rm portainer_agent_data
```

### 5. Liberar o Cloudflare Access (se houver)

Se o hostname do Portainer central é protegido por **Cloudflare Access**, o agente recebe a página de login em HTML no lugar de JSON e falha em loop com:

```
an error occurred during async poll | error="invalid character '<' looking for beginning of value"
```

A correção é liberar apenas o endpoint que o agente usa. Em **Zero Trust → Access → Applications → Add an application → Self-hosted**:

| Campo              | Valor                                   |
| ------------------ | --------------------------------------- |
| Application name   | `Portainer Edge`                        |
| Subdomain / Domain | `portainer` / `seudominio.com`          |
| Path               | `api/endpoints/edge/async`              |
| Policy             | Action **Bypass**, Include **Everyone** |

> ⚠️ O path é `api/endpoints/edge/async`, e não `api/edge`. O cliente async usa `/api/endpoints/edge/async` (ver `edge/client/portainer_edge_async_client.go` no repositório `portainer/agent`). Um bypass em `api/edge` não resolve nada.

Aplicações do Access com path mais específico têm precedência sobre a que cobre o domínio inteiro, então a interface web continua protegida por login. O endpoint liberado só aceita comandos de quem apresenta `EDGE_ID` e `EDGE_KEY` válidos.

### 6. Verificar

No servidor remoto:

```bash
# 1. O agente alcança o Portainer central?
docker run --rm -e EDGE_CONNECTIVITY_CHECK=1 \
  -e EDGE_CONNECTIVITY_CHECK_URL=https://portainer.seudominio.com \
  portainer/agent:latest

# 2. O endpoint do async responde o próprio Portainer?
curl -si -X POST https://portainer.seudominio.com/api/endpoints/edge/async \
  -H 'Content-Type: application/json' -d '{}' | head -3

# 3. O agente está pollando sem erro?
docker logs --tail 20 portainer_edge_agent
```

O comando 2 deve responder `HTTP/2 400` com `content-type: application/json`. O `400` aqui é sucesso: significa que a requisição chegou ao Portainer e ele apenas recusou o corpo vazio. Um `302` significa que o Access continua barrando.

Em até um ciclo de check-in (1 minuto) o ambiente sai de **Down / Not associated** e passa a **Heartbeat** na Home. O snapshot com a contagem de containers aparece no ciclo seguinte.

> ⚠️ O connectivity check do próprio agente (comando 1) retorna `PASS` mesmo com o Cloudflare Access bloqueando, porque ele só confirma que houve alguma resposta HTTP, sem validar o conteúdo. Não use esse teste isolado como prova de que está tudo certo.

### 7. O que muda no dia a dia

- A Home do central passa a listar todos os ambientes, e você alterna entre eles pelo seletor.
- As stacks que já existiam no host remoto aparecem como **stacks externas**: dá para ver os containers, iniciar e parar, mas não editar o compose. Para recuperar a edição, recrie a stack pelo central.
- O Portainer que já rodava no host remoto pode continuar ativo em paralelo, sem conflito. Ambos falam com o mesmo `docker.sock`.

### 8. Remover o agente

No host remoto:

```bash
docker stop portainer_edge_agent && docker rm portainer_edge_agent
docker volume rm portainer_agent_data
```

Depois apague o ambiente em **Environments** no central e, se tiver criado, a aplicação de bypass no Cloudflare Access.

### Troubleshooting

| Sintoma                                                                 | Causa                                                                                | Solução                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `invalid character '<' looking for beginning of value`                  | O agente recebeu HTML (login do Access, challenge de bot ou erro 5xx) em vez de JSON | Criar o bypass do Access no path `api/endpoints/edge/async`        |
| `curl` responde `HTTP/2 302` apontando para `*.cloudflareaccess.com`    | Cloudflare Access protegendo o endpoint                                              | Mesma solução acima                                                |
| Ambiente preso em **Down / Not associated** sem erro nos logs do agente | O agente foi instalado na máquina errada                                             | Remover container e volume, e rodar no host correto                |
| Connectivity check dá `PASS` mas o ambiente não conecta                 | O check só valida que houve resposta HTTP                                            | Testar o endpoint real com o `curl` do passo 6                     |
| `FAIL` ao testar o tunnel server na porta 8000                          | O modo Async não usa a porta 8000                                                    | Ignorar, e rodar o check sem `EDGE_CONNECTIVITY_CHECK_TUNNEL_ADDR` |
| Erro de limite de nós ao adicionar o ambiente                           | A licença BE cobre um número fixo de nós                                             | Conferir em **Administration → Licenses**                          |

**Referências:** [Install Edge Agent Async on Docker Standalone](https://docs.portainer.io/admin/environments/add/docker/edge-async) e [Edge Compute settings](https://docs.portainer.io/admin/settings/edge).

## Anexo A: Removendo Fixação de Versão Antiga

Se você seguiu versões anteriores deste guia e havia "travado" a versão do Docker na 5.28 (devido a um antigo bug de compatibilidade com o Portainer), siga os passos abaixo para destravar e atualizar para a versão mais recente:

```bash
# Destrava os pacotes do Docker
sudo apt-mark unhold docker-ce docker-ce-cli

# Atualiza para a versão mais recente
sudo apt-get update
sudo apt-get upgrade docker-ce docker-ce-cli
```

## Anexo B: Instalar e Travar uma Versão Específica do Docker (Troubleshooting)

Caso futuros bugs de compatibilidade exijam o uso de uma versão específica do Docker (como ocorria no passado com a versão 5.28), este é o procedimento histórico documentado para consulta:

### 1. Instalar Versão Específica

Atualizamos o `apt` e instalamos a versão exata do Docker:

```bash
# Atualiza a lista de pacotes
sudo apt-get update

# Define a string da versão exata (Exemplo baseado no Trixie/Debian 13)
VERSION_STRING=5:28.5.2-1~debian.13~trixie

# Instala os pacotes com a versão "pinada"
sudo apt-get install \
  docker-ce=$VERSION_STRING \
  docker-ce-cli=$VERSION_STRING \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin
```

### 2. Travar a Versão do Docker

Para evitar que um `sudo apt upgrade` acidental atualize o Docker e quebre a compatibilidade, nós "travamos" (hold) os pacotes na versão instalada.

```bash
sudo apt-mark hold docker-ce docker-ce-cli
```
