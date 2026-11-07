# ☁️ Oracle Cloud Free Tier VPS (ARM) via Pay-As-You-Go

A Oracle oferece uma excelente VPS gratuita (Ampere A1 ARM com 4 OCPUs, 24GB de RAM e 200GB de disco), mas contas "Always Free" comuns quase nunca conseguem criar a máquina devido ao erro de falta de estoque (`Out of host capacity`).

O segredo para ignorar essa restrição é fazer o upgrade da conta para **Pay-As-You-Go (PAYG)**. Contas pagas ganham prioridade máxima na alocação de hardware. Desde que você configure a máquina **estritamente dentro dos limites gratuitos**, você terá prioridade total e a cobrança será **zero**.

## 🛠️ Passo 0: Criar a VCN Principal (Rede Virtual)

Antes de criar a máquina, você precisa de uma rede configurada com acesso à internet. A forma mais rápida e limpa é usar o Assistente:

1. No menu lateral principal, vá em **Networking** (Rede) > **Virtual Cloud Networks**.
2. Clique no botão **Start VCN Wizard** (Iniciar Assistente de VCN).
3. Selecione a opção **VCN with Internet Connectivity** (VCN com Conetividade à Internet) e clique no botão inferior **Start VCN Wizard**.
4. No campo **VCN Name**, digite exatamente `vcn-principal`.
5. Deixe todos os blocos de IP (CIDR) padrão e as configurações do compartimento como estão.
6. Clique em **Next** (Próximo) no final da página e, na tela de revisão, clique em **Create** (Criar).

_Isso vai gerar automaticamente a sua `vcn-principal`, a `public subnet-vcn-principal` (sub-rede pública) e as tabelas de rotas necessárias._

## 🛠️ Passo 1: Criação da Instância no Painel

No menu lateral, vá em **Compute** > **Instances** e clique em **Create instance**.

### 1.1. Imagem e Forma (Shape)

- **Imagem:** Clique em _Alterar imagem_, escolha **Canonical Ubuntu 24.04 Minimal aarch64** (versão ARM).
- **Forma (Shape):** Clique em _Alterar forma_, selecione a aba **Ampere** e marque a caixa **VM.Standard.A1.Flex**.
- **Recursos:** Aloque o limite máximo gratuito: **4 OCPUs** e **24 GB** de memória RAM.

### 1.2. Configuração de Rede (Networking)

- **Rede:** Selecione sua Rede Virtual existente (ex: `vcn-principal`).
- **Sub-rede:** Selecione a sub-rede pública regional.
- **IP Público:** Certifique-se de marcar a opção **Atribuir um endereço IPv4 público automaticamente**.

### 1.3. Chaves SSH (Crucial)

- Selecione **Gerar um par de chaves para mim** (ou faça o upload da sua pública se preferir).
- ⚠️ **Obrigatório:** Clique no botão **Fazer download da chave privada** e salve o arquivo `.key` no seu computador. Sem ele, você perderá o acesso definitivo à VPS.

### 1.4. Armazenamento (Boot Volume)

- Ative a opção **Especifique um tamanho do volume de inicialização personalizado**.
- Altere o tamanho padrão de 46.6 GB para **200 GB** (limite máximo do Free Tier).
- Deixe o desempenho (VPU) em **10** (Balanceado).

_Role até o fim da página de Revisão e clique em **Criar**. Com a conta PAYG, a instância será criada imediatamente._

## 💻 Passo 2: Permissões da Chave no Windows (PowerShell)

O OpenSSH do Windows recusa conexões se o arquivo da chave privada estiver exposto a outros usuários do sistema.

1. Mova o arquivo baixado para `C:\Users\SEU_USUARIO\.ssh\oracle.key`.
2. Clique com o botão direito no arquivo `oracle.key` > **Propriedades** > aba **Segurança** > **Avançado**.
3. Clique em **Desabilitar herança** e selecione **Remover todas as permissões herdadas** (a lista deve ficar vazia).
4. Clique em **Adicionar** > **Selecionar uma entidade de segurança**.
5. Digite seu usuário exato do Windows, clique em **Verificar Nomes** e dê **OK**.
6. Marque a caixa **Controle total** e salve todas as janelas.

### 2.1. Primeiro Acesso SSH

Abra o PowerShell e execute:

```powershell
ssh -i "C:\Users\SEU_USUARIO\.ssh\oracle.key" ubuntu@IP_PUBLICO_DA_VPS

```

_Digite `yes` quando o terminal perguntar se confia no host._

## 🧱 Passo 3: Configuração do Firewall Duplo

A imagem padrão da Oracle vem com bloqueio total de tráfego de entrada. É obrigatório liberar as portas desejadas (ex: `80` para HTTP e `443` para HTTPS) no painel web e no sistema operacional.

### 3.1. Barreira 1: Painel Web (Security List)

1. No menu da instância, clique na aba **Rede** e acesse o link da sua sub-rede pública.
2. Na aba **Regras de segurança**, clique em **Adicionar Regras de Entrada**.
3. Configure a regra:

- **Tipo de Origem:** CIDR
- **CIDR de Origem:** `0.0.0.0/0` (Qualquer IP da internet)
- **Protocolo IP:** TCP
- **Intervalo de Portas de Destino:** `80,443`

4. Clique em **Adicionar Regras de Entrada**.

### 3.2. Barreira 2: Sistema Operacional (iptables)

Logado na VPS via SSH, execute os comandos abaixo para liberar as portas no Ubuntu e salvar as regras permanentemente:

```bash
# Libera as portas HTTP e HTTPS nas tabelas de INPUT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT

# Salva as regras para persistirem após reinicializações
sudo netfilter-persistent save
```

## 💾 Passo 4: Backups Gratuitos do Boot Volume

O Always Free inclui **5 backups de volume no total**, somando boot volumes e block volumes. Não são 5 por mês: é o máximo que pode existir **ao mesmo tempo** na conta (no CLI, o limite se chama `free-backup-count`). Do 6º em diante, cada backup é cobrado pelo tamanho, no preço do Object Storage, e numa conta PAYG a cobrança chega de verdade: backup diário (7 dias) mais semanal (4 semanas), num boot volume de 200 GB, custou de R$ 4 a R$ 6 por mês. O tamanho não conta para o limite: até 5 backups, mesmo somando dezenas de GB, o custo é zero.

> ⚠️ As policies prontas da Oracle passam de 5 e geram cobrança: a **Bronze** guarda 12 backups mensais e mais 1 anual por 5 anos, e a **Silver** e a **Gold** guardam ainda mais. Use uma policy **personalizada** (user-defined).

### 4.1. A Conta dos 5

- **Backup manual nunca expira:** ocupa uma vaga até você apagar.
- **Backup de policy expira sozinho**, e a retenção conta da hora em que ele foi criado de fato. Essa hora atrasa em relação ao agendado (o da 00h saiu entre 5h e 15h), então no dia da troca o novo pode nascer antes de o mais antigo sair: conte sempre **um a mais**.
- **Mudar a policy não mexe nos backups que já existem:** eles mantêm a data de expiração que tinham e seguem ocupando vaga, mesmo que o schedule deles tenha sido apagado.
- **Quem apaga o backup é o `retention-seconds`.** O `retention-period`, que aparece no mesmo schedule, só tem efeito com o retention lock, e os dois podem divergir (já vimos 90 dias num e 217 no outro). Na dúvida, confira a expiração dos backups ([4.3](#43-conferir)).

### 4.2. Policy Semanal com 4 Semanas

Semanal, domingo à 00h (horário da região), **incremental**, **28 dias** de retenção: ficam os backups das últimas 4 semanas, e 5 por algumas horas no domingo da troca. Só cabe se não houver nenhum outro backup na conta; com um backup manual guardado, use **21 dias**. Incremental basta: para restaurar não há diferença para o full, e quando o mais antigo expira a Oracle completa o seguinte para ele continuar restaurável.

Pelo painel, no caminho da doc da Oracle: na lista **Backup Policies**, clique em **Create backup policy** e dê um nome; na policy criada, vá em **Schedules** > **Add schedule**, com frequência semanal no domingo às 00:00, backup **Incremental**, fuso **Regional Data Center Time** e retenção de **28 DAYS**, sem retention lock. Depois edite o boot volume da instância e escolha a policy em **Backup Policies**.

Pelo OCI CLI, no notebook (instalação e credencial nas Partes 4 e 5 do [guia do Omarchy](./omarchy.md)):

```bash
TEN=$(awk -F= '/^tenancy/{print $2}' ~/.oci/config)   # o tenancy é o compartimento raiz
SCHEDULE='[{"backupType": "INCREMENTAL", "period": "ONE_WEEK", "dayOfWeek": "SUNDAY",
  "hourOfDay": 0, "offsetType": "STRUCTURED", "timeZone": "REGIONAL_DATA_CENTER_TIME",
  "retentionSeconds": 2419200,
  "retentionPeriod": {"retentionTimeAmount": 28, "retentionTimeUnit": "DAYS"}}]'

# Policy que já existe: troca a lista de schedules inteira
POLICY=$(oci bv volume-backup-policy list --compartment-id "$TEN" --all \
  --query "data[?\"display-name\"=='backup'].id | [0]" --raw-output)
oci bv volume-backup-policy update --policy-id "$POLICY" --schedules "$SCHEDULE" --force

# Conta sem policy: cria e aplica no boot volume (a conta tem um só)
POLICY=$(oci bv volume-backup-policy create --compartment-id "$TEN" --display-name backup \
  --schedules "$SCHEDULE" --query 'data.id' --raw-output)
BOOT=$(oci bv boot-volume list --compartment-id "$TEN" --all --query 'data[0].id' --raw-output)
oci bv volume-backup-policy-assignment create --asset-id "$BOOT" --policy-id "$POLICY"
```

O `2419200` são 28 dias em segundos (21 dias: `1814400`); mande os dois campos de retenção com o mesmo valor. _O `update` é o que foi aplicado na VPS em 06/11/2026; o `create` e o `assignment create` seguem a referência do CLI e não foram rodados aqui._

### 4.3. Conferir

```bash
# O schedule que vale
oci bv volume-backup-policy get --policy-id "$POLICY" --output table \
  --query 'data.schedules[0].{periodo:period,dia:"day-of-week",hora:"hour-of-day",retencao_s:"retention-seconds"}'

# Os backups e quando cada um expira: no máximo 5, somando tudo
oci bv boot-volume-backup list --compartment-id "$TEN" --all --output table \
  --query 'data[].{nome:"display-name",estado:"lifecycle-state",expira:"expiration-time"}'

# O limite grátis da conta
oci limits value list --compartment-id "$TEN" --service-name block-storage --all --output table \
  --query "data[?name=='free-backup-count'].{limite:name,valor:value}"

# Custo de backup por mês: mês sem linha saiu R$ 0
oci usage-api usage-summary request-summarized-usages --tenant-id "$TEN" \
  --time-usage-started 2026-09-01T00:00:00Z --time-usage-ended 2026-11-01T00:00:00Z \
  --granularity MONTHLY --query-type COST --group-by '["skuName"]' --output table \
  --query "data.items[?\"sku-name\"=='Block Volume - Backup'].{mes:\"time-usage-started\",custo:\"computed-amount\"}"
```

### 4.4. Trocando uma Policy Antiga

Os backups da policy anterior ficam até a data de expiração deles, e os manuais não expiram. Apague na hora os antigos que você não quer, **menos o mais recente**: sozinho, ele cobre a espera pelo **primeiro backup da policy nova** e ainda segura a VPS se ela falhar. Quando esse primeiro backup ficar `AVAILABLE`, apague o mais recente também, antes que a soma passe de 5. Apagar um backup full não estraga os incrementais que ficam: a Oracle completa o seguinte para ele continuar restaurável.

```bash
oci bv boot-volume-backup list --compartment-id "$TEN" --all --output table \
  --query 'data[].{id:id,nome:"display-name",estado:"lifecycle-state"}'
oci bv boot-volume-backup delete --boot-volume-backup-id ID_DO_BACKUP --force
```

> ℹ️ Fontes: [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Backup Policies](https://docs.oracle.com/en-us/iaas/Content/Block/Tasks/schedulingvolumebackups.htm), [Block Volume Backups](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumebackups.htm) e a referência do [`oci bv volume-backup-policy`](https://docs.oracle.com/en-us/iaas/tools/oci-cli/latest/oci_cli_docs/cmdref/bv/volume-backup-policy.html).

Pronto! Infraestrutura base configurada, segura e pronta para receber o Docker e seus containers. 🚀
