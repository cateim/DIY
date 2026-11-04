#!/usr/bin/env bash
# versao 2026-11-02 (filtro *.gvid): so sincroniza com o /home do Crucial. Com o home-emergencia.service (D4),
# o home de emergencia tambem e ponto de montagem, entao o teste "mountpoint -q /home" nao basta.
# Sincroniza ~/Drive com o Google Drive pelo rclone bisync, nos dois sentidos, a cada 15 min.
#
#   ./drive-sync.sh            primeira vez: remoto, filtros, conferencia, snapshot, primeira
#                              rodada (o mais novo vence) e timer
#   ./drive-sync.sh agora      roda uma sincronizacao na hora, igual a do timer
#   ./drive-sync.sh resync     refaz a base do bisync (obrigatorio depois de mudar os filtros)
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
UNIT_DIR="$HOME/.config/systemd/user"
MODO="${1:-configurar}"
# Path1 e sempre a nuvem e Path2 o disco: as listagens do bisync dependem dessa ordem.
BASE=(bisync "$REMOTO" "$LOCAL" --filters-file "$FILTROS" --drive-skip-gdocs --drive-skip-shortcuts)
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

primeira_rodada() {  # simulacao, confirmacao e resync de verdade (o mais novo vence)
  echo "== simulacao da rodada base (nada e copiado) =="
  if ! rclone "${BASE[@]}" --resync --resync-mode newer --dry-run -v 2> "$LOG_DIR/drive-simulacao.txt"; then
    echo "a simulacao falhou; veja $LOG_DIR/drive-simulacao.txt"; exit 1
  fi
  local n
  n="$(grep -c 'Skipped copy as --dry-run' "$LOG_DIR/drive-simulacao.txt" || true)"
  echo "  copias que a rodada faria: $n (exemplos abaixo; lista inteira em $LOG_DIR/drive-simulacao.txt)"
  grep 'Skipped copy as --dry-run' "$LOG_DIR/drive-simulacao.txt" | head -n 15 | sed 's/^/    /' || true
  read -r -p "Fazer a rodada base de verdade? Digite SIM: " ok
  [[ "$ok" == "SIM" ]] || { echo "parado; nada foi copiado"; exit 1; }
  rclone "${BASE[@]}" --resync --resync-mode newer -v --log-file "$LOG_DIR/drive-sync.log"
  echo "  rodada base concluida (log em $LOG_DIR/drive-sync.log)"
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
ExecCondition=/usr/bin/sh -c "findmnt -no SOURCE /home | grep -q '^/dev/mapper/cateim'"
ExecStart=/usr/bin/rclone ${BASE[*]} ${ROTINA[*]} --log-file $LOG_DIR/drive-sync.log --log-level INFO
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
systemctl --user daemon-reload
systemctl --user enable --now drive-sync.timer

echo
echo "PRONTO: ~/Drive sincroniza a cada 15 min. Para ver:"
echo "  systemctl --user list-timers drive-sync.timer"
echo "  tail -f $LOG_DIR/drive-sync.log"
echo "Uma rodada que apagaria mais de 5% dos arquivos para sozinha; olhe o log antes de repetir."
