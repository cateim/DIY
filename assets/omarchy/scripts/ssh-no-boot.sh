#!/usr/bin/env bash
# ==============================================================================
# ssh-no-boot.sh
# Liga o desbloqueio do LUKS do disco do sistema por SSH no boot: tinyssh no
# initramfs (mkinitcpio-tinyssh + mkinitcpio-netconf + mkinitcpio-utils).
# Criado em 03/11/2026 no notebook alienware. No DIY, IP, gateway e chaves vêm
# do private.env (modelo em ../private.env.example), nunca do script.
#
# - Rede do initramfs: só o cabo (BOOT_DEV no initramfs, enp59s0 no sistema), IP
#   fixo BOOT_IP. O Wi-Fi ainda não existe nessa hora. Sem cabo, o boot segue
#   igual e a senha é digitada no notebook, como sempre.
# - O /home destrava sozinho depois, com a chave em /etc/cryptsetup-keys.d/, que
#   fica dentro do sistema cifrado. Só a senha do sistema importa.
# - Quem entra: as chaves de UNLOCK_ROOT_KEYS. O login só dá o pedido de senha do
#   LUKS (cryptsetup_shell do mkinitcpio-utils), nunca um shell. Com a Plymouth, o
#   cryptsetup_shell mata o pedido de senha da tela, e o boot segue.
# - O hook encrypt é trocado num arquivo à parte (zz-ssh-no-boot.conf); o
#   omarchy_hooks.conf não é tocado.
#
# Desbloquear, de outra máquina da rede (aqui, o homelab):
#   ssh -i ~/.ssh/<chave-de-desbloqueio> root@<BOOT_IP>
#
# Desfazer:
#   sudo rm /etc/mkinitcpio.conf.d/zz-ssh-no-boot.conf /etc/limine-entry-tool.d/ssh-no-boot.conf
#   sudo limine-mkinitcpio
# ==============================================================================
set -euo pipefail

PRIVATE_ENV="${DIY_OMARCHY_PRIVATE:-$HOME/.config/diy-omarchy/private.env}"
# shellcheck source=/dev/null
[[ -f $PRIVATE_ENV ]] && source "$PRIVATE_ENV"
IP="${BOOT_IP:?defina BOOT_IP no $PRIVATE_ENV}"
GW="${BOOT_GW:?defina BOOT_GW no $PRIVATE_ENV}"
MASK="${BOOT_MASK:-255.255.255.0}"
DEV="${BOOT_DEV:-eth0}"
HOST="${BOOT_HOSTNAME:-alienware}"
# Uma chave ed25519 por linha (o tinyssh não aceita RSA).
ROOT_KEYS="${UNLOCK_ROOT_KEYS:?defina UNLOCK_ROOT_KEYS no $PRIVATE_ENV}"

LOG="$(mktemp --tmpdir ssh-no-boot.XXXXXX.log)"

echo "1/5 Snapshot antes de mexer no boot (volta pelo menu do Limine)"
omarchy-snapshot create

echo "2/5 Pacotes do repositório oficial"
omarchy pkg add mkinitcpio-tinyssh mkinitcpio-netconf mkinitcpio-utils

echo "3/5 Chaves autorizadas no initramfs"
sudo install -d -m 755 /etc/tinyssh
printf '%s\n' "$ROOT_KEYS" | sed '/^$/d' | sudo install -m 600 /dev/stdin /etc/tinyssh/root_key

echo "4/5 Hooks e rede do initramfs"
sudo tee /etc/mkinitcpio.conf.d/zz-ssh-no-boot.conf > /dev/null <<'CONF'
# Desbloqueio do LUKS por SSH no boot (ssh-no-boot.sh, 03/11/2026).
# Troca o hook encrypt do omarchy_hooks.conf por netconf + tinyssh + encryptssh sem reescrever
# a lista: se o Omarchy mudar os outros hooks, a troca continua valendo. Se um dia o Omarchy
# deixar de usar o encrypt, nada é trocado e o SSH no boot some sem quebrar o boot.
_hooks_ssh=()
for _h in "${HOOKS[@]}"; do
  if [[ $_h == encrypt ]]; then _hooks_ssh+=(netconf tinyssh encryptssh); else _hooks_ssh+=("$_h"); fi
done
HOOKS=("${_hooks_ssh[@]}")
unset _hooks_ssh _h
CONF
sudo tee /etc/limine-entry-tool.d/ssh-no-boot.conf > /dev/null <<CONF
# Rede do initramfs para o desbloqueio por SSH (ssh-no-boot.sh): IP fixo no cabo.
# O hook netconf tira o IP e derruba a placa antes de o sistema subir.
KERNEL_CMDLINE[default]+=" ip=$IP::$GW:$MASK:$HOST:$DEV:none"
CONF

echo "5/5 Gerando o initramfs e a entrada do Limine (log em $LOG)"
build_ok=1
sudo limine-mkinitcpio 2>&1 | tee "$LOG" || build_ok=0

echo
echo "== Conferência"
ok=1
for h in netconf tinyssh encryptssh; do
  if grep -q "Running build hook: \[$h\]" "$LOG"; then echo "hook $h: ok"; else echo "hook $h: NÃO apareceu no build"; ok=0; fi
done
if (( ! build_ok )) || grep -q 'ERROR' "$LOG"; then echo "o build falhou ou tem ERROR (veja $LOG)"; ok=0; fi
# A linha do kernel fica dentro do UKI. Confere o .efi que o build copiou (o caminho sai do log)
# e o limine.conf. A primeira versão (03/11/2026) procurava pela data dos arquivos no /boot e
# falhou com o ip= presente nos dois.
efi="$(grep -oE '/boot/[^ ]+\.efi' "$LOG" | tail -1)"
if [[ -n "$efi" ]] && sudo grep -qaF "ip=$IP::$GW:$MASK:$HOST:$DEV:none" "$efi" /boot/limine.conf; then
  echo "linha do kernel: ok ($efi)"
else
  echo "linha do kernel: ip= NÃO está em ${efi:-<nenhum .efi no log>} nem no /boot/limine.conf"; ok=0
fi
# Sem chave de host o tinyssh não sobe, mas o boot segue com a senha no notebook: só avisa.
if sudo test -d /etc/tinyssh/sshkeydir; then echo "chave de host do tinyssh: ok"; else echo "AVISO: /etc/tinyssh/sshkeydir não existe; o SSH no boot pode não subir (conteúdo: $(sudo ls /etc/tinyssh | tr '\n' ' '))"; fi
echo
if (( ok )); then
  echo "Pronto. Para testar: ligue o cabo, reinicie e, do homelab, rode o comando do cabeçalho deste script."
else
  echo "Algo falhou: NÃO reinicie. Desfaça com os comandos do cabeçalho deste script e me mostre o log."
fi
