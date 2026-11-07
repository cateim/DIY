#!/bin/bash
# Entrypoint do WireGuard: a unica porta de entrada do stack. Guia: docs/wireguard.md
# no repo DIY. No repo da stack, fica em docker/wireguard/entrypoint.sh.
#
# O que ele faz, em toda subida:
#   1. Gera (uma vez so) a chave do servidor e a de cada PC listado em WG_PEERS,
#      guardadas em /config. Numa subida seguinte, reusa as mesmas.
#   2. Escreve o .conf de cada PC em /config/peers/<nome>.conf, pronto para
#      importar no WireGuard for Windows.
#   3. Fecha o firewall antes de o wg0 existir: pelo tunel, o PC so alcanca o
#      Firebird (FB_IP), desde o primeiro pacote.
#   4. Sobe o wg0 (10.77.0.1/24) com o WireGuard do kernel do host.
# Depois, fica em primeiro plano ate o container parar.
#
# Nenhuma chave privada vai para o log.

set -euo pipefail

CONFIG_DIR=${CONFIG_DIR:-/config}
RUN_DIR=${RUN_DIR:-/run/wireguard}
PEERS_DIR="$CONFIG_DIR/peers"
TUNNEL_PREFIX=10.77.0                  # /24 do tunel: servidor .1, PCs .2 a .254
TUNNEL_NET="$TUNNEL_PREFIX.0/24"
SERVER_TUNNEL_IP="$TUNNEL_PREFIX.1"
LISTEN_PORT=51820                      # dentro do container; o host publica WG_PORT
WG_PORT=${WG_PORT:-51820}

log() { echo "[wireguard] $*"; }
die() { echo "[wireguard] ERRO: $*" >&2; exit 1; }

# ---- 1. Config: tudo validado antes de gerar chave ou mexer na rede ----
# Uma config errada para aqui, sem criar arquivo de chave nem meio tunel.
[ -n "${WG_ENDPOINT:-}" ] || die "WG_ENDPOINT vazio (IP publico ou DNS do A1)."
[[ $WG_ENDPOINT =~ ^[A-Za-z0-9.-]+$ ]] \
  || die "WG_ENDPOINT invalido: '$WG_ENDPOINT' (so o host, sem porta; a porta vem de WG_PORT)."
[[ $WG_PORT =~ ^[0-9]{1,5}$ ]] && (( 10#$WG_PORT >= 1 && 10#$WG_PORT <= 65535 )) \
  || die "WG_PORT invalido: '$WG_PORT'."
[[ ${FB_IP:-} =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || die "FB_IP vazio ou invalido: '${FB_IP:-}'."
[ -n "${WG_PEERS:-}" ] || die "WG_PEERS vazio (ex.: pc-teste:10)."

# WG_PEERS = "nome:final,nome:final". O final vira o IP do PC: 10.77.0.<final>.
PEER_NAMES=()
PEER_OCTETS=()
declare -A seen_name=() seen_octet=()
IFS=',' read -r -a entries <<< "$WG_PEERS"
for entry in "${entries[@]}"; do
  entry=${entry//[[:space:]]/}
  [ -n "$entry" ] || continue
  [[ $entry =~ ^([a-z0-9][a-z0-9-]{0,30}):([0-9]{1,3})$ ]] \
    || die "peer invalido em WG_PEERS: '$entry' (formato nome:final; nome com a-z, 0-9 e -)."
  name=${BASH_REMATCH[1]}
  octet=$((10#${BASH_REMATCH[2]}))
  (( octet >= 2 && octet <= 254 )) || die "peer $name: final $octet fora de 2 a 254 (o .1 e do servidor)."
  [ -z "${seen_name[$name]:-}" ] || die "peer repetido em WG_PEERS: $name."
  [ -z "${seen_octet[$octet]:-}" ] || die "final $octet repetido em WG_PEERS (${seen_octet[$octet]} e $name)."
  seen_name[$name]=1
  seen_octet[$octet]=$name
  PEER_NAMES+=("$name")
  PEER_OCTETS+=("$octet")
done
(( ${#PEER_NAMES[@]} > 0 )) || die "WG_PEERS sem nenhum peer."

# ---- 2. Chaves (geradas uma vez, so legiveis pelo root) ----
umask 077
mkdir -p "$PEERS_DIR" "$RUN_DIR"
chmod 700 "$PEERS_DIR"

ensure_secret() {   # arquivo, subcomando do wg (genkey ou genpsk)
  [ -s "$1" ] || wg "$2" > "$1"
  chmod 600 "$1"
}

ensure_secret "$CONFIG_DIR/server.key" genkey
server_pub=$(wg pubkey < "$CONFIG_DIR/server.key")

server_conf="$RUN_DIR/wg0.conf"
printf '[Interface]\nPrivateKey = %s\nListenPort = %s\n' \
  "$(cat "$CONFIG_DIR/server.key")" "$LISTEN_PORT" > "$server_conf"

# ---- 3. Um bloco [Peer] no servidor e um .conf por PC ----
write_peer_conf() {   # nome, ip no tunel
  local name=$1 ip=$2
  cat > "$PEERS_DIR/$name.conf" <<EOF
# Tunel WireGuard do PC "$name".
# Importar no WireGuard for Windows (Importar tunel de arquivo) e Ativar.
# Pelo tunel passa so o Firebird; o resto da rede do PC nao muda.
# Tem a chave privada deste PC: nao mandar por e-mail nem deixar no Drive.
[Interface]
PrivateKey = $(cat "$PEERS_DIR/$name.key")
Address = $ip/32

[Peer]
PublicKey = $server_pub
PresharedKey = $(cat "$PEERS_DIR/$name.psk")
Endpoint = $WG_ENDPOINT:$WG_PORT
AllowedIPs = $FB_IP/32, $SERVER_TUNNEL_IP/32
PersistentKeepalive = 25
EOF
  chmod 600 "$PEERS_DIR/$name.conf"
}

for i in "${!PEER_NAMES[@]}"; do
  name=${PEER_NAMES[$i]}
  ip="$TUNNEL_PREFIX.${PEER_OCTETS[$i]}"
  ensure_secret "$PEERS_DIR/$name.key" genkey
  ensure_secret "$PEERS_DIR/$name.psk" genpsk
  printf '\n[Peer]\nPublicKey = %s\nPresharedKey = %s\nAllowedIPs = %s/32\n' \
    "$(wg pubkey < "$PEERS_DIR/$name.key")" "$(cat "$PEERS_DIR/$name.psk")" "$ip" >> "$server_conf"
  write_peer_conf "$name" "$ip"
  log "peer $name: $ip (config em $PEERS_DIR/$name.conf)"
done

# ---- 4. Firewall: o tunel so leva ao Firebird ----
# Vem antes de existir o wg0: o netns novo nasce com FORWARD em ACCEPT e o compose
# ja ligou o ip_forward, entao um wg0 no ar antes destas regras deixaria um peer
# passar para qualquer lugar por alguns milissegundos. As regras casam o wg0 pelo
# nome, e valem a partir do primeiro pacote dele.
# So adiciona a regra que ainda nao existe. Sem -F de proposito: o Docker poe no
# nat deste netns as regras do DNS embutido (127.0.0.11).
ensure_rule() {   # tabela, chain, regra...
  local table=$1 chain=$2
  shift 2
  iptables -t "$table" -C "$chain" "$@" 2>/dev/null || iptables -t "$table" -A "$chain" "$@"
}
iptables -P FORWARD DROP
ensure_rule filter FORWARD -i wg0 -d "$FB_IP" -p tcp -j ACCEPT
ensure_rule filter FORWARD -i wg0 -d "$FB_IP" -p icmp -j ACCEPT
ensure_rule filter FORWARD -o wg0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# O Firebird responde para o IP deste container, que devolve pelo tunel. Sem isso
# ele precisaria de rota para 10.77.0.0/24.
ensure_rule nat POSTROUTING -s "$TUNNEL_NET" -d "$FB_IP" -j MASQUERADE
ensure_rule filter INPUT -i wg0 -p icmp -j ACCEPT
ensure_rule filter INPUT -i wg0 -j DROP

# ---- 5. Interface ----
ip link del wg0 2>/dev/null || true
ip link add wg0 type wireguard
wg setconf wg0 "$server_conf"
ip -4 address add "$SERVER_TUNNEL_IP/24" dev wg0
ip link set wg0 up

log "tunel no ar: $SERVER_TUNNEL_IP/24, UDP $LISTEN_PORT (no host: $WG_PORT), ${#PEER_NAMES[@]} peer(s)."
log "chave publica do servidor: $server_pub"

trap 'log "parando"; ip link del wg0 2>/dev/null || true; exit 0' TERM INT
sleep infinity &
wait $!
