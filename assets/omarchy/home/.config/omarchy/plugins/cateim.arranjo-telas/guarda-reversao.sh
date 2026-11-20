#!/usr/bin/env bash
# Revert guard for the display arrangement panel (cateim.arranjo-telas).
#
# Runs outside the shell, so a pending arrangement is undone even when the
# shell dies, hangs or reloads the plugin during the confirmation countdown.
# Always called as "bash <absolute path>/guarda-reversao.sh <command> ...", so
# it never depends on the exec bit, which the copy in the DIY repo may lose.
#
#   armar <id> <aviso> <volta>  write the pending mark, then start the timer
#   desarmar <id>               drop the mark (if it is <id>) and stop the timer
#   reverter <id>               run by the timer: eval <volta>, reload on failure
#   partida                     on plugin start: revert a mark whose timer is gone
#
# Mark file, $XDG_RUNTIME_DIR/cateim-arranjo-telas/pendente (folder 0700):
#   line 1: id, line 2: notification text, lines 3+: Lua snippet to eval.
#
# Exit codes: 0 ok, 2 bad usage or id, 3 mark already present (armar),
# 4 systemd-run failed (armar), 5 could not write the mark (armar).
set -euo pipefail

readonly ID_REGEX='^[0-9a-f]{16}$'
readonly PASTA_NOME="cateim-arranjo-telas"
readonly MARCA_NOME="pendente"
readonly UNIDADE_PREFIXO="cateim-arranjo-telas-guarda-"
readonly ATRASO_GUARDA="30s"
readonly APP_NOME="Arranjo das telas"
readonly RESPOSTA_OK="ok"
# Shown instead of the mark's notice when neither the eval nor the reload worked.
readonly AVISO_FALHOU="Arranjo das telas: não foi possível reverter; confira as telas no painel Display"

readonly EXIT_USO=2
readonly EXIT_MARCA_EXISTE=3
readonly EXIT_SYSTEMD_RUN=4
readonly EXIT_GRAVACAO=5

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
readonly SCRIPT_PATH

log() {
  printf 'guarda-reversao: %s\n' "$*" >&2
}

uso() {
  log "usage: guarda-reversao.sh armar <id> <aviso> <volta> | desarmar <id> | reverter <id> | partida"
  exit "$EXIT_USO"
}

id_valido() {
  [[ "$1" =~ $ID_REGEX ]]
}

# Prints the mark folder; fails when XDG_RUNTIME_DIR is missing.
pasta_marca() {
  [[ -n "${XDG_RUNTIME_DIR:-}" ]] || return 1
  printf '%s/%s' "$XDG_RUNTIME_DIR" "$PASTA_NOME"
}

# Prints the first line of the mark, or fails when there is no mark.
id_da_marca() {
  local marca="$1" linha
  [[ -f "$marca" ]] || return 1
  IFS= read -r linha < "$marca" || return 1
  printf '%s' "$linha"
}

trim() {
  local texto="$1"
  texto="${texto#"${texto%%[![:space:]]*}"}"
  texto="${texto%"${texto##*[![:space:]]}"}"
  printf '%s' "$texto"
}

cmd_armar() {
  [[ $# -eq 3 ]] || uso
  local id="$1" aviso="$2" volta="$3"
  id_valido "$id" || { log "invalid id"; exit "$EXIT_USO"; }
  # Line 2 of the mark holds the notification; a newline would shift the snippet.
  [[ "$aviso" != *$'\n'* ]] || { log "notification text must be one line"; exit "$EXIT_USO"; }

  local pasta marca tmp
  pasta="$(pasta_marca)" || { log "XDG_RUNTIME_DIR is not set"; exit "$EXIT_GRAVACAO"; }
  marca="$pasta/$MARCA_NOME"
  if [[ -e "$marca" || -L "$marca" ]]; then
    log "a pending mark already exists"
    exit "$EXIT_MARCA_EXISTE"
  fi

  mkdir -p -m 700 "$pasta" 2>/dev/null || { log "cannot create $pasta"; exit "$EXIT_GRAVACAO"; }
  chmod 700 "$pasta" 2>/dev/null || { log "cannot chmod $pasta"; exit "$EXIT_GRAVACAO"; }
  tmp="$(mktemp "$pasta/.$MARCA_NOME.XXXXXX" 2>/dev/null)" || { log "cannot create temp mark"; exit "$EXIT_GRAVACAO"; }
  if ! printf '%s\n%s\n%s' "$id" "$aviso" "$volta" > "$tmp"; then
    rm -f -- "$tmp"
    log "cannot write temp mark"
    exit "$EXIT_GRAVACAO"
  fi
  if ! mv -f -- "$tmp" "$marca"; then
    rm -f -- "$tmp"
    log "cannot move temp mark into place"
    exit "$EXIT_GRAVACAO"
  fi

  # Mark before timer, timer before any eval (I12). No timer means no apply.
  if ! systemd-run --user --quiet --collect --on-active="$ATRASO_GUARDA" \
      --unit="$UNIDADE_PREFIXO$id" --setenv=HYPRLAND_INSTANCE_SIGNATURE \
      bash "$SCRIPT_PATH" reverter "$id"; then
    rm -f -- "$marca"
    log "systemd-run failed; mark removed"
    exit "$EXIT_SYSTEMD_RUN"
  fi
  exit 0
}

cmd_desarmar() {
  [[ $# -eq 1 ]] || uso
  local id="$1" pasta marca
  if ! id_valido "$id"; then
    log "invalid id; nothing disarmed"
    exit 0
  fi
  if pasta="$(pasta_marca)"; then
    marca="$pasta/$MARCA_NOME"
    if [[ "$(id_da_marca "$marca" 2>/dev/null || true)" == "$id" ]]; then
      rm -f -- "$marca"
    fi
  fi
  systemctl --user stop "$UNIDADE_PREFIXO$id.timer" >/dev/null 2>&1 || true
  exit 0
}

cmd_reverter() {
  [[ $# -eq 1 ]] || uso
  local id="$1" pasta marca conteudo resto aviso volta saida rc=0 bem_formada=1
  id_valido "$id" || { log "invalid id"; exit "$EXIT_USO"; }
  pasta="$(pasta_marca)" || exit 0
  marca="$pasta/$MARCA_NOME"
  [[ -f "$marca" ]] || exit 0
  conteudo="$(cat -- "$marca" 2>/dev/null)" || exit 0
  [[ "${conteudo%%$'\n'*}" == "$id" ]] || exit 0

  # Command substitution drops trailing newlines of the snippet; harmless for Lua.
  if [[ "$conteudo" == *$'\n'*$'\n'* ]]; then
    resto="${conteudo#*$'\n'}"
    aviso="${resto%%$'\n'*}"
    volta="${resto#*$'\n'}"
  else
    bem_formada=0
    aviso="$APP_NOME"
    volta=""
  fi
  rm -f -- "$marca"

  if [[ "$bem_formada" -eq 1 ]]; then
    saida="$(hyprctl eval "$volta" 2>&1)" || rc=$?
  else
    log "malformed mark; skipping eval"
    saida=""
    rc=1
  fi
  if [[ "$rc" -ne 0 || "$(trim "$saida")" != "$RESPOSTA_OK" ]]; then
    log "eval failed (exit $rc): $(trim "$saida"); running hyprctl reload"
    if ! hyprctl reload >/dev/null 2>&1; then
      log "hyprctl reload failed"
      aviso="$AVISO_FALHOU"
    fi
  fi
  notify-send -a "$APP_NOME" "$aviso" >/dev/null 2>&1 || log "notify-send failed"
  exit 0
}

cmd_partida() {
  [[ $# -eq 0 ]] || uso
  local pasta marca id
  pasta="$(pasta_marca)" || exit 0
  marca="$pasta/$MARCA_NOME"
  [[ -e "$marca" || -L "$marca" ]] || exit 0
  # A mark with no valid id can never be disarmed and would block every armar
  # (exit 3) until logout: drop it. Its snippet is not trusted, so no eval.
  id="$(id_da_marca "$marca" 2>/dev/null || true)"
  if ! id_valido "$id"; then
    rm -f -- "$marca" 2>/dev/null || { log "cannot remove a mark without a valid id"; exit 0; }
    log "mark without a valid id; removed"
    exit 0
  fi
  if systemctl --user is-active --quiet "$UNIDADE_PREFIXO$id.timer"; then
    exit 0
  fi
  cmd_reverter "$id"
}

[[ $# -ge 1 ]] || uso
comando="$1"
shift
case "$comando" in
  armar) cmd_armar "$@" ;;
  desarmar) cmd_desarmar "$@" ;;
  reverter) cmd_reverter "$@" ;;
  partida) cmd_partida "$@" ;;
  *) uso ;;
esac
