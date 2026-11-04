#!/usr/bin/env bash
# ==============================================================================
# export.sh: copia as personalizações do Omarchy deste notebook para o DIY
#
# Lê files.txt, refaz home/ (entradas "~/...") e system/ (entradas "/...") do
# zero e troca os valores do private.env por placeholders <<NOME>> (e o $HOME
# por <<HOME>>). No fim procura segredo ou dado pessoal que tenha sobrado e
# falha se achar: nada deste espelho vai para o GitHub sem passar por isso.
#
# Uso: assets/omarchy/export.sh
# Rode depois de qualquer personalização nova ou removida, antes do commit.
# ==============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRIVATE_ENV="${DIY_OMARCHY_PRIVATE:-$HOME/.config/diy-omarchy/private.env}"

# Trocados nos arquivos copiados. O mais longo vem antes, para um valor que
# contenha outro não ser cortado no meio.
PLACEHOLDER_KEYS=(WAYVNC_PASSWORD CHROMIUM_OAUTH_CLIENT_SECRET CHROMIUM_OAUTH_CLIENT_ID FORGEJO_ONION GIT_EMAIL GIT_NAME DOMAIN VPS_NAME HOMELAB_NAME)
EXCLUDES=(CHECKLIST.md '*.bak.*' '*.bak' node_modules)

# Nunca podem sair: chave privada, token do GitHub, senha/segredo/token em
# claro, IP do Tailscale (100.64.0.0/10) ou de rede local, e-mail e .onion.
LEAK_PATTERNS='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|(password|passwd|secret|token)[[:space:]]*[=:][[:space:]]*[^<[:space:]]|(^|[^0-9.])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}|(^|[^0-9.])192\.168\.[0-9]{1,3}\.[0-9]{1,3}|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]*[a-z]{2,}|[a-z2-7]{56}\.onion'

die() { echo "export.sh: $*" >&2; exit 1; }

load_private_env() {
  [[ -f $PRIVATE_ENV ]] || die "falta $PRIVATE_ENV (o modelo é private.env.example)"
  # shellcheck source=/dev/null
  source "$PRIVATE_ENV"
  local key
  for key in "${PLACEHOLDER_KEYS[@]}"; do
    [[ -n ${!key:-} ]] || die "$key está vazio em $PRIVATE_ENV"
  done
}

# "~/x" -> home/x e "/etc/x" -> system/etc/x
mirror_path() {
  case $1 in
    "~/"*) echo "$ROOT/home/${1#\~/}" ;;
    /*) echo "$ROOT/system$1" ;;
    *) die "caminho inválido em files.txt: $1" ;;
  esac
}

real_path() {
  case $1 in
    "~/"*) echo "$HOME/${1#\~/}" ;;
    *) echo "$1" ;;
  esac
}

tracked_entries() {
  grep -vE '^[[:space:]]*(#|$)' "$ROOT/files.txt" | sed -E 's/[[:space:]]+$//'
}

reset_mirror() {
  # Guarda contra apagar outra coisa se ROOT vier errado.
  [[ $ROOT == */assets/omarchy && -f $ROOT/files.txt ]] || die "ROOT inesperado: $ROOT"
  rm -rf -- "$ROOT/home" "$ROOT/system"
}

copy_entry() {
  local src=$1 dst=$2 pattern
  local args=(-a)
  for pattern in "${EXCLUDES[@]}"; do args+=(--exclude "$pattern"); done
  if [[ ! -e $src ]]; then
    echo "aviso: $src não existe, ficou de fora" >&2
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -d $src ]]; then
    rsync "${args[@]}" "$src/" "$dst/"
  else
    rsync "${args[@]}" "$src" "$dst"
  fi
}

redact_file() {
  local file=$1 key
  grep -Iq . "$file" || return 0 # binário ou vazio: não mexe
  for key in "${PLACEHOLDER_KEYS[@]}"; do
    VALUE="${!key}" KEY="$key" perl -pi -e 's/\Q$ENV{VALUE}\E/<<$ENV{KEY}>>/g' "$file"
  done
  HOMEDIR="$HOME" perl -pi -e 's/\Q$ENV{HOMEDIR}\E/<<HOME>>/g' "$file"
}

scan_for_leaks() {
  local hits
  hits=$(grep -rInE "$LEAK_PATTERNS" "$ROOT/home" "$ROOT/system" 2>/dev/null | cut -d: -f1,2 || true)
  [[ -z $hits ]] && return 0
  echo "export.sh: possível segredo ou dado pessoal (arquivo:linha). Ponha o valor no" >&2
  echo "private.env ou tire o arquivo do files.txt, e rode de novo. NÃO commite assim:" >&2
  echo "${hits//$ROOT\//}" >&2
  exit 1
}

main() {
  load_private_env
  reset_mirror
  local entry count=0
  while IFS= read -r entry; do
    copy_entry "$(real_path "$entry")" "$(mirror_path "${entry%/}")"
    count=$((count + 1))
  done < <(tracked_entries)

  local file
  while IFS= read -r -d '' file; do redact_file "$file"; done \
    < <(find "$ROOT/home" "$ROOT/system" -type f -print0 2>/dev/null)

  scan_for_leaks
  echo "export.sh: $count entradas copiadas para $ROOT/{home,system}, sem segredo à vista."
  git -C "$ROOT" status --short -- . 2>/dev/null | sed 's/^/  /' || true
}

main "$@"
