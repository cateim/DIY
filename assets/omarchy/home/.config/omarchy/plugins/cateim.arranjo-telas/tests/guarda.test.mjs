// Run from the plugin directory: node --test tests/*.test.mjs
// Drives guarda-reversao.sh through stubs of hyprctl, systemd-run, systemctl
// and notify-send. Nothing here may reach the live session: the stubs come
// first on PATH, and the env drops the Hyprland and D-Bus addresses, so a
// stub that lost its exec bit falls through to a real binary that has
// nothing to talk to.
import { test, before } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// Resolved the same way the script resolves itself (readlink -f), so a
// symlinked ~/.config still matches the argv it hands to systemd-run.
const SCRIPT = join(realpathSync(fileURLToPath(new URL("..", import.meta.url))), "guarda-reversao.sh")
const STUBS = fileURLToPath(new URL("./stubs", import.meta.url))
const STUB_NAMES = ["hyprctl", "systemd-run", "systemctl", "notify-send"]
const PASTA_MARCA = "cateim-arranjo-telas"
const UNIDADE = "cateim-arranjo-telas-guarda-"
const ID = "0123456789abcdef"
const OUTRO_ID = "fedcba9876543210"
const AVISO = "Arranjo das telas revertido: o painel não respondeu"
const VOLTA_SIMPLES = 'hl.monitor({ output = "DP-1", position = "0x0" })'

before(() => {
  for (const nome of STUB_NAMES) chmodSync(join(STUBS, nome), 0o755)
})

function ambiente(extra = {}) {
  const runtime = mkdtempSync(join(tmpdir(), "guarda-test-"))
  const env = { ...process.env }
  delete env.HYPRLAND_INSTANCE_SIGNATURE
  delete env.DBUS_SESSION_BUS_ADDRESS
  Object.assign(env, {
    PATH: `${STUBS}:${process.env.PATH}`,
    XDG_RUNTIME_DIR: runtime,
    STUB_LOG: join(runtime, "stub.log"),
    ...extra,
  })
  return env
}

function rodar(env, ...args) {
  return spawnSync("bash", [SCRIPT, ...args], { env, encoding: "utf8" })
}

function pasta(env) { return join(env.XDG_RUNTIME_DIR, PASTA_MARCA) }
function marca(env) { return join(pasta(env), "pendente") }

function chamadas(env) {
  if (!existsSync(env.STUB_LOG)) return []
  const lista = []
  let atual = []
  for (const linha of readFileSync(env.STUB_LOG, "utf8").split("\n")) {
    if (linha === "@@") { lista.push(atual); atual = [] } else if (linha !== "" || atual.length) atual.push(linha)
  }
  return lista
}

function chamadasDe(env, nome) { return chamadas(env).filter((c) => c[0] === nome).map((c) => c.slice(1)) }

function gravarMarca(env, id, aviso, volta) {
  mkdirSync(pasta(env), { recursive: true, mode: 0o700 })
  writeFileSync(marca(env), `${id}\n${aviso}\n${volta}`)
}

test("armar recusa id inválido e não chama systemd-run", () => {
  for (const ruim of ["0123456789ABCDEF", "0123", "0123456789abcdef0", "../../etc/passw", ""]) {
    const env = ambiente()
    const r = rodar(env, "armar", ruim, AVISO, VOLTA_SIMPLES)
    assert.equal(r.status, 2, `id ${JSON.stringify(ruim)}: ${r.stderr}`)
    assert.equal(existsSync(marca(env)), false)
    assert.deepEqual(chamadasDe(env, "systemd-run"), [])
  }
})

test("armar grava a marca 0700 e chama systemd-run com os argumentos exatos", () => {
  const env = ambiente()
  // An existing folder with loose permissions must be tightened too.
  mkdirSync(pasta(env), { mode: 0o755 })
  chmodSync(pasta(env), 0o755)
  const r = rodar(env, "armar", ID, AVISO, VOLTA_SIMPLES)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(statSync(pasta(env)).mode & 0o777, 0o700)
  assert.equal(readFileSync(marca(env), "utf8"), `${ID}\n${AVISO}\n${VOLTA_SIMPLES}`)
  const runs = chamadasDe(env, "systemd-run")
  assert.equal(runs.length, 1)
  assert.deepEqual(runs[0], [
    "--user", "--quiet", "--collect", "--on-active=30s",
    `--unit=${UNIDADE}${ID}`, "--setenv=HYPRLAND_INSTANCE_SIGNATURE",
    "bash", SCRIPT, "reverter", ID,
  ])
})

test("armar cria a pasta 0700 quando ela não existe", () => {
  const env = ambiente()
  const r = rodar(env, "armar", ID, AVISO, VOLTA_SIMPLES)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(statSync(pasta(env)).mode & 0o777, 0o700)
})

test("armar com systemd-run falhando sai com 4 e apaga a marca", () => {
  const env = ambiente({ STUB_RUN_EXIT: "1" })
  const r = rodar(env, "armar", ID, AVISO, VOLTA_SIMPLES)
  assert.equal(r.status, 4, r.stderr)
  assert.equal(chamadasDe(env, "systemd-run").length, 1)
  assert.equal(existsSync(marca(env)), false)
})

test("armar com a marca já existente sai com 3", () => {
  const env = ambiente()
  gravarMarca(env, OUTRO_ID, AVISO, VOLTA_SIMPLES)
  const r = rodar(env, "armar", ID, AVISO, VOLTA_SIMPLES)
  assert.equal(r.status, 3, r.stderr)
  assert.equal(readFileSync(marca(env), "utf8"), `${OUTRO_ID}\n${AVISO}\n${VOLTA_SIMPLES}`)
  assert.deepEqual(chamadasDe(env, "systemd-run"), [])
})

test("armar com falha na gravação sai com 5", () => {
  const env = ambiente()
  // A plain file where the folder should be makes mkdir fail.
  writeFileSync(pasta(env), "")
  const r = rodar(env, "armar", ID, AVISO, VOLTA_SIMPLES)
  assert.equal(r.status, 5, r.stderr)
  assert.deepEqual(chamadasDe(env, "systemd-run"), [])
})

test("armar recusa aviso com quebra de linha", () => {
  const env = ambiente()
  const r = rodar(env, "armar", ID, "linha 1\nlinha 2", VOLTA_SIMPLES)
  assert.equal(r.status, 2, r.stderr)
  assert.equal(existsSync(marca(env)), false)
  assert.deepEqual(chamadasDe(env, "systemd-run"), [])
})

test("reverter com outro id não faz nada", () => {
  const env = ambiente()
  gravarMarca(env, OUTRO_ID, AVISO, VOLTA_SIMPLES)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, "")
  assert.equal(existsSync(marca(env)), true)
  assert.deepEqual(chamadasDe(env, "hyprctl"), [])
  assert.deepEqual(chamadasDe(env, "notify-send"), [])
})

test("reverter sem marca sai com 0 calado", () => {
  const env = ambiente()
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(chamadas(env), [])
})

test("reverter com id inválido sai com 2", () => {
  const env = ambiente()
  gravarMarca(env, ID, AVISO, VOLTA_SIMPLES)
  const r = rodar(env, "reverter", "nao-e-hex")
  assert.equal(r.status, 2, r.stderr)
  assert.equal(existsSync(marca(env)), true)
  assert.deepEqual(chamadas(env), [])
})

test("reverter com o id certo avalia o trecho guardado e apaga a marca", () => {
  const env = ambiente()
  const volta = 'hl.monitor({ output = "DP-1", position = "2048x36" }) -- $(touch /tmp/x) "aspas"'
  gravarMarca(env, ID, AVISO, volta)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(marca(env)), false)
  const hypr = chamadasDe(env, "hyprctl")
  assert.deepEqual(hypr, [["eval", volta]])
  assert.equal(readFileSync(`${env.STUB_LOG}.eval`, "utf8"), volta)
  assert.deepEqual(chamadasDe(env, "notify-send"), [["-a", "Arranjo das telas", AVISO]])
})

test("reverter passa volta de várias linhas inteira como um argumento", () => {
  const env = ambiente()
  const volta = 'hl.monitor({ output = "DP-1", position = "0x0" })\nhl.monitor({ output = "HDMI-A-1", position = "1920x0" })'
  gravarMarca(env, ID, AVISO, volta)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(readFileSync(`${env.STUB_LOG}.eval`, "utf8"), volta)
  assert.equal(chamadasDe(env, "hyprctl").length, 1)
})

test("reverter com resposta diferente de ok roda hyprctl reload", () => {
  const env = ambiente({ STUB_EVAL_SAIDA: "error: [string \"x\"]:1: boom" })
  gravarMarca(env, ID, AVISO, VOLTA_SIMPLES)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(marca(env)), false)
  assert.deepEqual(chamadasDe(env, "hyprctl"), [["eval", VOLTA_SIMPLES], ["reload"]])
  assert.deepEqual(chamadasDe(env, "notify-send"), [["-a", "Arranjo das telas", AVISO]])
})

test("reverter com eval e reload falhando avisa a falha, não o revertido", () => {
  const env = ambiente({ STUB_EVAL_SAIDA: "error: boom", STUB_RELOAD_FALHA: "1" })
  gravarMarca(env, ID, AVISO, VOLTA_SIMPLES)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(chamadasDe(env, "hyprctl"), [["eval", VOLTA_SIMPLES], ["reload"]])
  const avisos = chamadasDe(env, "notify-send")
  assert.equal(avisos.length, 1)
  assert.notEqual(avisos[0][2], AVISO)
  assert.match(avisos[0][2], /não foi possível reverter/)
})

test("reverter com resposta ok não roda hyprctl reload", () => {
  const env = ambiente({ STUB_EVAL_SAIDA: "ok" })
  gravarMarca(env, ID, AVISO, VOLTA_SIMPLES)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(chamadasDe(env, "hyprctl"), [["eval", VOLTA_SIMPLES]])
})

test("reverter com marca malformada e o id certo pula o eval e roda hyprctl reload", () => {
  const env = ambiente()
  mkdirSync(pasta(env), { recursive: true, mode: 0o700 })
  writeFileSync(marca(env), `${ID}\n`)
  const r = rodar(env, "reverter", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(marca(env)), false)
  assert.deepEqual(chamadasDe(env, "hyprctl"), [["reload"]])
  assert.equal(chamadasDe(env, "notify-send").length, 1)
})

test("desarmar com o id certo apaga a marca e para o .timer; com outro id mantém", () => {
  const certo = ambiente()
  gravarMarca(certo, ID, AVISO, VOLTA_SIMPLES)
  let r = rodar(certo, "desarmar", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(marca(certo)), false)
  assert.deepEqual(chamadasDe(certo, "systemctl"), [["--user", "stop", `${UNIDADE}${ID}.timer`]])

  const outro = ambiente()
  gravarMarca(outro, OUTRO_ID, AVISO, VOLTA_SIMPLES)
  r = rodar(outro, "desarmar", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(marca(outro)), true)
  assert.deepEqual(chamadasDe(outro, "hyprctl"), [])
})

test("desarmar sem marca sai com 0", () => {
  const env = ambiente()
  const r = rodar(env, "desarmar", ID)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(chamadasDe(env, "hyprctl").length, 0)
})

test("partida reverte quando o timer não está ativo e não faz nada quando está", () => {
  const parado = ambiente({ STUB_ATIVO: "0" })
  gravarMarca(parado, ID, AVISO, VOLTA_SIMPLES)
  let r = rodar(parado, "partida")
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(chamadasDe(parado, "systemctl"), [["--user", "is-active", "--quiet", `${UNIDADE}${ID}.timer`]])
  assert.deepEqual(chamadasDe(parado, "hyprctl"), [["eval", VOLTA_SIMPLES]])
  assert.equal(existsSync(marca(parado)), false)
  assert.equal(chamadasDe(parado, "notify-send").length, 1)

  const ativo = ambiente({ STUB_ATIVO: "1" })
  gravarMarca(ativo, ID, AVISO, VOLTA_SIMPLES)
  r = rodar(ativo, "partida")
  assert.equal(r.status, 0, r.stderr)
  assert.equal(chamadasDe(ativo, "systemctl").length, 1)
  assert.deepEqual(chamadasDe(ativo, "hyprctl"), [])
  assert.equal(existsSync(marca(ativo)), true)
})

test("partida apaga marca com id inválido ou vazia, sem eval", () => {
  for (const conteudo of ["nao-e-um-id\naviso\nvolta", ""]) {
    const env = ambiente({ STUB_ATIVO: "0" })
    mkdirSync(pasta(env), { recursive: true, mode: 0o700 })
    writeFileSync(marca(env), conteudo)
    const r = rodar(env, "partida")
    assert.equal(r.status, 0, r.stderr)
    assert.equal(existsSync(marca(env)), false, JSON.stringify(conteudo))
    assert.deepEqual(chamadasDe(env, "hyprctl"), [])
    // the next armar is no longer blocked
    assert.equal(rodar(env, "armar", ID, AVISO, VOLTA_SIMPLES).status, 0)
  }
})

test("partida sem marca não chama nada", () => {
  const env = ambiente()
  const r = rodar(env, "partida")
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(chamadas(env), [])
})

test("comando desconhecido ou argumentos faltando saem com 2", () => {
  const env = ambiente()
  assert.equal(rodar(env).status, 2)
  assert.equal(rodar(env, "apagar-tudo").status, 2)
  assert.equal(rodar(env, "armar", ID, AVISO).status, 2)
  assert.equal(rodar(env, "reverter").status, 2)
  assert.deepEqual(chamadas(env), [])
})
