#!/usr/bin/env bash
# versao 2026-11-07 (resync com o ~/Drive em uso): so sincroniza com o /home do Crucial. Com o home-emergencia.service (D4),
# o home de emergencia tambem e ponto de montagem, entao o teste "mountpoint -q /home" nao basta.
# Sincroniza ~/Drive com o Google Drive pelo rclone bisync, nos dois sentidos, a cada 15 min.
#
#   ./drive-sync.sh            primeira vez: remoto, filtros, conferencia, snapshot, primeira
#                              rodada (o mais novo vence) e timer
#   ./drive-sync.sh agora      roda uma sincronizacao na hora, igual a do timer
#   ./drive-sync.sh resync     refaz a base do bisync (obrigatorio depois de mudar os filtros);
#                              o ~/Drive pode seguir em uso, o que mudar no meio e conferido no fim
#
# Fica de fora (~/.config/rclone/gdrive-filtros.txt): .git, .venv, node_modules e saidas de
# build dos repositorios, atalhos do Google Docs e lixo do Windows. Os .env e tudo o mais que
# nao vai para o GitHub sincronizam normalmente.
#
# Antes da primeira vez, crie um client_id proprio (o compartilhado do rclone esta sendo
# aposentado em 2026): console.cloud.google.com > novo projeto > APIs e servicos > ativar
# "Google Drive API" > Tela de consentimento (externo) > Credenciais > Criar ID do cliente
# OAuth > App para computador. Guarde ID e chave secreta no Bitwarden.
#
# Feito em 01/11 no projeto "Cateim Antigravity": cliente "rclone-drive-sync", app "Pessoal"
# PUBLICADO ("In production"). Em "Testing" o Google faz a autorizacao vencer a cada 7 dias e
# o timer parava toda semana; publicado, ela nao vence (na autorizacao aparece "app nao
# verificado": Avancado > continuar). Publicar exigiu pagina inicial e politica de privacidade
# num dominio proprio: https://<<DOMAIN>>/privacidade.
#
# O JSON do cliente (botao "Download JSON") fica em ~/.config/rclone/oauth-rclone-drive-sync.json,
# chmod 600. Se ele estiver la, o script le o ID e a chave dele; se nao, pede para colar.
set -euo pipefail

LOCAL="$HOME/Drive"
REMOTO="gdrive:"
CONF_DIR="$HOME/.config/rclone"
FILTROS="$CONF_DIR/gdrive-filtros.txt"
OAUTH_JSON="$CONF_DIR/oauth-rclone-drive-sync.json"
LOG_DIR="$HOME/.local/state"
# As listagens do bisync (a base dos dois lados) ficam em ~/.local/state, nunca no ~/.cache, que e
# o padrao do rclone: em 06/11 o ~/.cache foi apagado para liberar espaco, as listagens foram junto
# e o bisync parou ate um resync.
WORKDIR="$HOME/.local/state/rclone/bisync"
UNIT_DIR="$HOME/.config/systemd/user"
MODO="${1:-configurar}"
# Path1 e sempre a nuvem e Path2 o disco: as listagens do bisync dependem dessa ordem.
BASE=(bisync "$REMOTO" "$LOCAL" --workdir "$WORKDIR" --filters-file "$FILTROS" --drive-skip-gdocs --drive-skip-shortcuts)
ROTINA=(--resilient --recover --max-lock 2m --max-delete 5 --conflict-resolve newer)

findmnt -no SOURCE /home | grep -q '^/dev/mapper/cateim' || { echo "o /home nao e o do Crucial (home de emergencia?): nao sincronizo"; exit 1; }
[[ -d "$LOCAL" ]] || { echo "nao achei $LOCAL (rode o organizar-home.sh antes)"; exit 1; }
mkdir -p "$CONF_DIR" "$LOG_DIR"

escrever_filtros() {
  local novo
  novo="$(mktemp)"
  cat > "$novo" <<'EOF'
# gdrive-filtros.txt: o que o rclone bisync NAO sincroniza entre ~/Drive e o Google Drive.
# Gerado pelo drive-sync.sh. Mudou este arquivo? Rode ./drive-sync.sh resync (o bisync exige).
# Regra sem "/" no inicio vale em qualquer pasta; "/GitHub/**/x/**" vale so nos repositorios.

# ---- Git: o historico vive no GitHub e no Forgejo ----
- .git/**
- .git

# ---- Dependencias e ambientes, refeitos com um comando ----
- node_modules/**
- .venv/**
- __pycache__/**
- *.pyc
- /GitHub/**/venv/**

# ---- Builds e caches dos repositorios ----
- /GitHub/**/build/**
- /GitHub/**/dist/**
- /GitHub/**/target/**
- /GitHub/**/.pio/**
- /GitHub/**/managed_components/**
- /GitHub/**/.next/**
- /GitHub/**/.nuxt/**
- /GitHub/**/.svelte-kit/**
- /GitHub/**/.turbo/**
- /GitHub/**/.parcel-cache/**
- /GitHub/**/.cache/**
- /GitHub/**/coverage/**
- /GitHub/**/.pytest_cache/**
- /GitHub/**/.mypy_cache/**
- /GitHub/**/.ruff_cache/**
- /GitHub/**/.tox/**
- /GitHub/**/.gradle/**
- /GitHub/**/.dart_tool/**
- graphify-out/**

# ---- Atalhos do Google Docs: o documento vive na nuvem e abre no navegador ----
- *.gdoc
- *.gsheet
- *.gslides
- *.gdraw
- *.gform
- *.gscript
- *.gsite
- *.gmap
- *.gjam
- *.glink
- *.gvid

# ---- Lixo do Windows, de editores e do Drive for desktop ----
- desktop.ini
- Thumbs.db
- .DS_Store
- .~lock.*#
- .tmp.drivedownload/**
- .tmp.driveupload/**

# ---- Links simbolicos dos repositorios que tem arquivo de mesmo nome na nuvem ----
# O rclone ignora link no disco, e o Windows subiu cada um como arquivo de texto. Sem estas
# regras, a rodada base baixaria o texto por cima do link que o organizar-home.sh refez (01/11).
- /GitHub/origo/components/libwally-core/upstream/src/ccan/ccan/**/LICENSE
- /GitHub/wiim/custom_components/home_topology
- /GitHub/wiim/custom_components/home_topology/**
EOF
  if [[ -f "$FILTROS" ]] && ! cmp -s "$novo" "$FILTROS"; then
    cp -a -- "$FILTROS" "$FILTROS.antes-$(date +%Y%m%d-%H%M)"
    echo "aviso: os filtros mudaram; a proxima rodada precisa de ./drive-sync.sh resync"
  fi
  mv -- "$novo" "$FILTROS"
}

# A rodada base leva mais que os 15 min do timer: sem a pausa, a rodada do timer bate no lock dela,
# falha e vira alarme falso no drive-sync-aviso. O timer volta sozinho quando o script termina, e a
# marca com o pid deste script diz ao vigia (drive-sync-vigia.timer) que a pausa e de proposito.
pausar_timer() {
  systemctl --user is-active --quiet drive-sync.timer || return 0
  mkdir -p "$LOG_DIR/drive-sync"
  echo $$ > "$LOG_DIR/drive-sync/pausado"
  systemctl --user stop drive-sync.timer
  trap 'systemctl --user start drive-sync.timer; rm -f "$LOG_DIR/drive-sync/pausado"' EXIT
  while [[ "$(systemctl --user show -p ActiveState --value drive-sync.service)" =~ ^(activating|deactivating)$ ]]; do
    echo "  esperando terminar a rodada do timer que esta em andamento..."; sleep 15
  done
}

# O rclone grava cada nome com o %q do Go (no ~/Drive aparecem \" e ‎). Imprime um registro por
# arquivo diferente entre as duas listagens, campos separados por NUL: lado mais novo (notebook ou
# nuvem), caminho e detalhe. Igual e o que o check-sync do rclone tambem acha igual: mesmo tamanho e
# data a menos de 1 ms, a precisao do Google Drive.
divergencias() {  # listagem da nuvem (path1), listagem do disco (path2)
  python3 - "$1" "$2" <<'PY'
import calendar, json, re, sys, time

LINHA = re.compile(r'^(\S+) +(-?\d+) \S+ \S+ (\S+) "(.*)"$')
DATA = re.compile(r'^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d{4})$')
JANELA = 1_000_000  # 1 ms, em ns


def ns(texto):
    m = DATA.match(texto)
    if not m:
        raise ValueError('data fora do formato')
    seg = calendar.timegm(tuple(int(x) for x in m.groups()[:6]))
    if m[8] != 'Z':
        seg -= (1 if m[8][0] == '+' else -1) * (int(m[8][1:3]) * 3600 + int(m[8][3:5]) * 60)
    return seg * 10**9 + int((m[7] or '0').ljust(9, '0'))


def ler(caminho):
    arquivos = {}
    with open(caminho, encoding='utf-8') as f:
        for n, linha in enumerate(f, 1):
            linha = linha.rstrip('\n')
            if not linha or linha.startswith('#'):
                continue
            m = LINHA.match(linha)
            if not m:
                sys.exit(f'{caminho}:{n}: linha fora do formato do bisync: {linha[:120]}')
            if m[1] != '-':
                continue
            try:
                arquivos[json.loads(f'"{m[4]}"')] = (int(m[2]), ns(m[3]))
            except ValueError as erro:
                sys.exit(f'{caminho}:{n}: {erro}: {linha[:120]}')
    return arquivos


def quando(t):
    return time.strftime('%d/%m %H:%M:%S', time.localtime(t // 10**9))


nuvem, disco = ler(sys.argv[1]), ler(sys.argv[2])
for nome in sorted(nuvem.keys() | disco.keys()):
    if nome not in nuvem:
        lado, detalhe = 'notebook', 'so no notebook'
    elif nome not in disco:
        lado, detalhe = 'nuvem', 'so na nuvem'
    else:
        (tam1, t1), (tam2, t2) = nuvem[nome], disco[nome]
        if (tam1 < 0 or tam2 < 0 or tam1 == tam2) and abs(t1 - t2) < JANELA:
            continue
        lado = 'notebook' if t2 - t1 >= JANELA else 'nuvem'
        detalhe = f'nuvem {quando(t1)}, {tam1} B; notebook {quando(t2)}, {tam2} B'
    for campo in (lado, nome, detalhe):
        sys.stdout.buffer.write(campo.encode('utf-8', 'surrogateescape') + b'\0')
PY
}

# Arquivo que muda no meio do resync deixa as duas listagens diferentes nele, e a rodada normal seguinte
# cai com "out of sync" e perde a base (testado em 06/11). O touch marca o arquivo como mudado depois da
# base, e a rodada normal leva a versao que vale para o outro lado. Mais novo no notebook (o caso dos
# agentes): vale o notebook, sem perguntar. Mais novo ou so na nuvem: pergunta, porque "o mais novo
# vence" traria de volta um arquivo apagado de proposito no notebook durante a rodada.
conferir_base() {
  local tmp i lado caminho detalhe pergunta resp
  local -a l1 l2 regs
  l1=("$WORKDIR"/*.path1.lst) l2=("$WORKDIR"/*.path2.lst)
  if (( ${#l1[@]} != 1 || ${#l2[@]} != 1 )) || [[ ! -f ${l1[0]} || ! -f ${l2[0]} ]]; then
    echo "nao achei uma listagem de cada lado em $WORKDIR"; exit 1
  fi
  tmp="$(mktemp)"
  if ! divergencias "${l1[0]}" "${l2[0]}" > "$tmp"; then
    rm -f -- "$tmp"; echo "nao consegui comparar as listagens"; exit 1
  fi
  mapfile -d '' -t regs < "$tmp"; rm -f -- "$tmp"
  if (( ${#regs[@]} == 0 )); then
    echo "  nada mudou durante a rodada base"; return 0
  fi
  echo "  $(( ${#regs[@]} / 3 )) arquivo(s) mudaram durante a rodada base"
  for (( i = 0; i < ${#regs[@]}; i += 3 )); do
    lado=${regs[i]} caminho=${regs[i+1]} detalhe=${regs[i+2]}
    if [[ $lado == notebook ]]; then
      echo "  notebook: $caminho ($detalhe): vai para a nuvem"
      touch -c -- "$LOCAL/$caminho"
      continue
    fi
    echo "  nuvem: $caminho ($detalhe)"
    if [[ $detalhe == "so na nuvem" ]]; then
      pergunta="    n = volta para o notebook, l = sai da nuvem (vai para a lixeira do Drive): "
    else
      pergunta="    n = vale o da nuvem, l = vale o do notebook: "
    fi
    resp=
    until [[ $resp == [nl] ]]; do
      read -r -p "$pergunta" resp || {
        echo; echo "sem resposta: parado antes da rodada normal; o timer volta, mas falha ate outro resync"; exit 1
      }
    done
    if [[ $resp == n ]]; then
      rclone touch --no-create "$REMOTO$caminho"
    elif [[ $detalhe == "so na nuvem" ]]; then
      rclone deletefile "$REMOTO$caminho"
    else
      touch -c -- "$LOCAL/$caminho"
    fi
  done
}

rodada_normal() {  # a mesma do timer, que volta a exigir que as duas listagens batam
  echo "== rodada normal (uns 8 min) =="
  if ! rclone "${BASE[@]}" "${ROTINA[@]}" --log-file "$LOG_DIR/drive-sync.log" --log-level INFO; then
    echo "a rodada normal falhou; veja $LOG_DIR/drive-sync.log"; exit 1
  fi
  echo "  rodada normal concluida: a base nova bate dos dois lados"
}

primeira_rodada() {  # simulacao, confirmacao, resync (o mais novo vence), conferencia e rodada normal
  command -v python3 >/dev/null || { echo "a conferencia do resync precisa do python3"; exit 1; }
  pausar_timer
  # O resync lista os dois lados mais de uma vez e, por padrao, exige no fim que as listagens batam:
  # arquivo que mudava no meio (agente, editor, export.sh do DIY) derrubava a rodada base inteira, tres
  # vezes em 06/11. Aqui a exigencia fica desligada (--check-sync=false), o conferir_base resolve o que
  # mudou no meio, e a rodada normal, que exige, confirma.
  echo "o $LOCAL pode seguir em uso: o que mudar durante a rodada base e conferido no fim (uns 40 min ao todo)"
  echo "== simulacao da rodada base (nada e copiado) =="
  if ! rclone "${BASE[@]}" --resync --resync-mode newer --check-sync=false --dry-run -v 2> "$LOG_DIR/drive-simulacao.txt"; then
    echo "a simulacao falhou; veja $LOG_DIR/drive-simulacao.txt"; exit 1
  fi
  local n
  n="$(grep -c 'Skipped copy as --dry-run' "$LOG_DIR/drive-simulacao.txt" || true)"
  echo "  copias que a rodada faria: $n (exemplos abaixo; lista inteira em $LOG_DIR/drive-simulacao.txt)"
  grep 'Skipped copy as --dry-run' "$LOG_DIR/drive-simulacao.txt" | head -n 15 | sed 's/^/    /' || true
  read -r -p "Fazer a rodada base de verdade? Digite SIM: " ok
  [[ "$ok" == "SIM" ]] || { echo "parado; nada foi copiado"; exit 1; }
  echo "== rodada base (uns 16 min; acompanhe com tail -f $LOG_DIR/drive-sync.log) =="
  if ! rclone "${BASE[@]}" --resync --resync-mode newer --check-sync=false -v --log-file "$LOG_DIR/drive-sync.log"; then
    echo "a rodada base falhou; veja $LOG_DIR/drive-sync.log"; exit 1
  fi
  echo "== o que mudou durante a rodada base =="
  conferir_base
  rodada_normal
}

case "$MODO" in
  agora)
    systemctl --user start drive-sync.service
    tail -n 20 "$LOG_DIR/drive-sync.log"
    exit 0
    ;;
  resync)
    escrever_filtros
    primeira_rodada
    exit 0
    ;;
  configurar) ;;
  *) echo "uso: $0 [agora|resync]"; exit 1 ;;
esac

if ! command -v rclone >/dev/null; then sudo pacman -S --needed --noconfirm rclone; fi
ver="$(rclone version | head -n 1 | grep -oE '[0-9]+\.[0-9]+' | head -n 1)"
if (( ${ver%%.*} == 1 && ${ver#*.} < 66 )); then echo "rclone $ver e velho: o --resync-mode precisa do 1.66 ou mais novo"; exit 1; fi

echo "== 1/5 remoto $REMOTO =="
if ! rclone listremotes | grep -qx "$REMOTO"; then
  cid=""; csec=""
  if [[ -r "$OAUTH_JSON" ]] && command -v jq >/dev/null; then
    cid="$(jq -r '.installed.client_id // empty' "$OAUTH_JSON")"
    csec="$(jq -r '.installed.client_secret // empty' "$OAUTH_JSON")"
  fi
  if [[ -n "$cid" && -n "$csec" ]]; then
    echo "  client_id e chave secreta lidos de $OAUTH_JSON"
  else
    echo "Cole o client_id e a chave secreta do ID do cliente OAuth (veja o topo deste script)."
    read -r -p "client_id: " cid
    read -r -s -p "chave secreta: " csec; echo
  fi
  echo "O navegador vai abrir para voce autorizar o acesso ao Drive."
  rclone config create gdrive drive scope=drive client_id="$cid" client_secret="$csec" >/dev/null
  unset csec
fi
rclone lsd "$REMOTO" >/dev/null || { echo "nao consegui listar o Google Drive pelo remoto $REMOTO"; exit 1; }

echo "== 2/5 filtros =="
escrever_filtros
echo "  $FILTROS"

echo "== 3/5 conferencia entre a nuvem e o disco (nao copia nada; alguns minutos) =="
rclone check "$REMOTO" "$LOCAL" --filter-from "$FILTROS" --drive-skip-gdocs --drive-skip-shortcuts \
  --combined "$LOG_DIR/drive-check.txt" >/dev/null 2>&1 || true
contar() { grep -c "^$1 " "$LOG_DIR/drive-check.txt" || true; }
# No --combined do rclone check a nuvem e a origem: "+" falta no disco (so na nuvem) e "-" falta
# na nuvem (so no disco). Ate 01/11 os dois rotulos estavam trocados.
echo "  iguais: $(contar '=') | so na nuvem: $(contar '+') | so no disco: $(contar '-') | diferentes: $(contar '\*') | erros: $(contar '!')"
echo "  lista em $LOG_DIR/drive-check.txt"

echo "== 4/5 snapshot do /home antes da rodada base =="
fonte="$(findmnt -no SOURCE /home)"
sudo mount --mkdir -o subvolid=5 "${fonte%%\[*}" /mnt/crucial-topo
snap="/mnt/crucial-topo/@home-antes-drive-$(date +%Y%m%d-%H%M)"
sudo btrfs subvolume snapshot -r /home "$snap" >/dev/null
sudo umount /mnt/crucial-topo && sudo rmdir /mnt/crucial-topo
echo "  snapshot so leitura: ${snap#/mnt/crucial-topo/} (na raiz do btrfs do Crucial, fora do /home)"

echo "== 5/5 rodada base e timer =="
primeira_rodada
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/drive-sync.service" <<EOF
[Unit]
Description=rclone bisync de ~/Drive com o Google Drive

[Service]
Type=oneshot
# Rodada travada vira falha, e aviso, em vez de parada muda (uma rodada normal leva uns 8 min).
TimeoutStartSec=2h
ExecCondition=/usr/bin/sh -c "findmnt -no SOURCE /home | grep -q '^/dev/mapper/cateim'"
ExecStart=/usr/bin/rclone ${BASE[*]} ${ROTINA[*]} --log-file $LOG_DIR/drive-sync.log --log-level INFO
# Avisa na tela quando a rodada falha, e quando volta a funcionar (06/11).
ExecStopPost=-$HOME/.local/bin/drive-sync-aviso
Nice=10
IOSchedulingClass=idle
EOF
cat > "$UNIT_DIR/drive-sync.timer" <<'EOF'
[Unit]
Description=Sincroniza ~/Drive com o Google Drive a cada 15 min

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
EOF
# O vigia cobre o que o aviso da rodada nao ve: timer desligado ou fora do boot, unit que nao
# carrega. Nesses casos nenhuma rodada acontece, entao nenhum ExecStopPost roda (06/11).
cat > "$UNIT_DIR/drive-sync-vigia.service" <<EOF
[Unit]
Description=Confere se o drive-sync ainda tem rodadas (timer ligado e no boot, unit carregada)

[Service]
Type=oneshot
ExecCondition=/usr/bin/sh -c "findmnt -no SOURCE /home | grep -q '^/dev/mapper/cateim'"
ExecStart=$HOME/.local/bin/drive-sync-aviso --vigia
EOF
cat > "$UNIT_DIR/drive-sync-vigia.timer" <<'EOF'
[Unit]
Description=Confere a cada hora se o drive-sync continua ligado

[Timer]
# Conta do inicio do systemd do usuario, nao do boot: no login os dois timers sobem juntos, e o
# vigia nao pode olhar o drive-sync.timer antes de ele subir.
OnStartupSec=10min
OnUnitActiveSec=1h

[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now drive-sync.timer drive-sync-vigia.timer

echo
echo "PRONTO: ~/Drive sincroniza a cada 15 min, e o vigia confere o timer a cada hora. Para ver:"
echo "  systemctl --user list-timers 'drive-sync*'"
echo "  tail -f $LOG_DIR/drive-sync.log"
echo "Uma rodada que apagaria mais de 5% dos arquivos para sozinha; olhe o log antes de repetir."
