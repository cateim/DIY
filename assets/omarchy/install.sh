#!/usr/bin/env bash
# ==============================================================================
# install.sh: devolve ao sistema as personalizações do Omarchy guardadas no DIY
#
# Copia home/ para ~ e, com --system, system/ para / (com sudo), trocando os
# placeholders <<NOME>> pelos valores do private.env e <<HOME>> pelo $HOME.
# Arquivo que já existe e é diferente ganha antes um backup <arquivo>.bak.<epoch>,
# o mesmo padrão do Omarchy. Arquivo igual é deixado como está.
#
# Uso:
#   assets/omarchy/install.sh --dry-run            mostra o que faria, sem mexer
#   assets/omarchy/install.sh                      só os arquivos do usuário (~)
#   assets/omarchy/install.sh --system             também os do /etc (pede sudo)
#   assets/omarchy/install.sh --system --dry-run   os dois, só mostrando
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_ENV="${DIY_OMARCHY_PRIVATE:-$HOME/.config/diy-omarchy/private.env}"
EPOCH="$(date +%s)"
# Placeholders que guardam segredo (regex alternada): o arquivo fica com modo 600.
SECRET_KEYS='WAYVNC_PASSWORD|CHROMIUM_OAUTH_CLIENT_SECRET'
DRY_RUN=0
WITH_SYSTEM=0
CHANGED=()
PENDING=()

die() { echo "install.sh: $*" >&2; exit 1; }

parse_args() {
  local arg
  for arg in "$@"; do
    case $arg in
      --dry-run) DRY_RUN=1 ;;
      --system) WITH_SYSTEM=1 ;;
      -h | --help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
      *) die "opção desconhecida: $arg (veja --help)" ;;
    esac
  done
}

load_private_env() {
  if [[ ! -f $PRIVATE_ENV ]]; then
    echo "aviso: sem $PRIVATE_ENV; os <<NOME>> ficam nos arquivos até você preencher" >&2
    return 0
  fi
  set -a
  # shellcheck source=/dev/null
  source "$PRIVATE_ENV"
  set +a
}

# Escreve em stdout o arquivo do espelho já com os valores no lugar.
render() {
  perl -pe 's/<<HOME>>/$ENV{HOME}/g; s/<<([A-Z_]+)>>/(defined $ENV{$1} && length $ENV{$1}) ? $ENV{$1} : "<<$1>>"/ge' "$1"
}

install_one() {
  local src=$1 dst=$2 sudo_cmd=$3 tmp mode check_cmd=$3
  tmp="$(mktemp)"
  render "$src" > "$tmp"
  mode="$(stat -c %a "$src")"
  # O git só guarda o bit de execução: num clone novo tudo vira 644. Arquivo
  # que recebe um segredo do private.env fica só para o dono.
  if grep -qE "<<($SECRET_KEYS)>>" "$src"; then mode=600; fi
  # A simulação nunca pede sudo; os arquivos do /etc deste espelho são legíveis.
  ((DRY_RUN)) && check_cmd=""

  if $check_cmd test -e "$dst" && $check_cmd cmp -s "$tmp" "$dst"; then
    rm -f "$tmp"
    return 0
  fi
  if grep -qE '<<[A-Z_]+>>' "$tmp"; then PENDING+=("$dst"); fi

  if ((DRY_RUN)); then
    if test -e "$dst"; then echo "  trocaria (com backup): $dst"; else echo "  criaria: $dst"; fi
    rm -f "$tmp"
    return 0
  fi
  if $sudo_cmd test -e "$dst"; then $sudo_cmd cp -a "$dst" "$dst.bak.$EPOCH"; fi
  $sudo_cmd install -D -m "$mode" "$tmp" "$dst"
  rm -f "$tmp"
  CHANGED+=("$dst")
  echo "  instalado: $dst"
}

install_tree() {
  local base=$1 target_prefix=$2 sudo_cmd=$3 src rel
  [[ -d $base ]] || return 0
  while IFS= read -r -d '' src; do
    rel="${src#"$base"/}"
    install_one "$src" "$target_prefix/$rel" "$sudo_cmd"
  done < <(find "$base" -type f -print0 | sort -z)
}

print_next_steps() {
  echo
  echo "Próximos passos (o install.sh não reinicia nada):"
  echo "  hyprctl reload && hyprctl configerrors"
  echo "  omarchy restart shell        # plugins keepLoaded só trocam de código assim"
  echo "  systemctl --user daemon-reload && systemctl --user enable --now drive-sync.timer wayvnc.service"
  if ((WITH_SYSTEM)); then
    echo "  sudo systemctl daemon-reload && sudo systemctl enable home-emergencia.service"
    echo "  sudo udevadm control --reload-rules && sudo udevadm trigger"
    echo "  sudo limine-mkinitcpio       # aplica o alienware-display.conf na linha do kernel"
  fi
}

main() {
  parse_args "$@"
  load_private_env
  ((DRY_RUN)) && echo "install.sh: modo simulação, nada vai ser alterado"

  echo "Arquivos do usuário (~):"
  install_tree "$ROOT/home" "$HOME" ""
  if ((WITH_SYSTEM)); then
    echo "Arquivos do sistema (/):"
    install_tree "$ROOT/system" "" "sudo"
  fi

  if ((${#PENDING[@]})); then
    echo
    echo "Ainda com <<NOME>> (falta o valor no $PRIVATE_ENV):"
    printf '  %s\n' "${PENDING[@]}"
  fi
  ((DRY_RUN)) || echo "install.sh: ${#CHANGED[@]} arquivos instalados, backups com sufixo .bak.$EPOCH"
  print_next_steps
}

main "$@"
