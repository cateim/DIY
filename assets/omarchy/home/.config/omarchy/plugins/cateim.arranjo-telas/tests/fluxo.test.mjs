// Run from the plugin directory: node --test tests/*.test.mjs
// State machine of the apply / confirm / revert flow (spec 8.6, Rulings 9 and 15).
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { carregar, plain, fixture } from "./carregar-modelo.mjs"

const Fluxo = carregar("Fluxo.js")

const RTK = "Invalid Vendor Codename - RTK FHD demoset-1"
const ID = "0123456789abcdef"
const IDA = 'hl.monitor({ output = "DP-1", mode = "1920x1080@60.00", position = "2560x0", transform = 0 })'
const VOLTA = 'hl.monitor({ output = "DP-1", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })'
const ALVO = [{ porta: "DP-1", desc: RTK, modo: "1920x1080@60.00", x: 2560, y: 0, transform: 0 }]
const ANTES = [{ porta: "DP-1", desc: RTK, modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0 }]

// Raw screens as the read-back gets them (Geo.lerMonitores telas + fora).
const tela = (porta, x, y, escala120, extra) =>
  Object.assign({ porta, desc: RTK, modo: "1920x1080@60.00", w: 1920, h: 1080, hz: 60, x, y, transform: 0,
                  escala120, ligada: true, espelho: false, interna: false }, extra || {})
const EDP1 = { porta: "eDP-1", desc: "AU Optronics 0x1396", modo: "2560x1440@120.05", w: 2560, h: 1440, hz: 120.05,
               x: 0, y: 0, transform: 0, escala120: 150, ligada: true, espelho: false, interna: true }
const TELAS_ALVO = [EDP1, tela("DP-1", 2560, 0, 120)]
const TELAS_ANTES = [EDP1, tela("DP-1", 2048, 36, 120)]
const TELAS_OUTRA = [EDP1, tela("DP-1", 1000, 1000, 120)]

const aplicar = (extra) => Object.assign({
  tipo: "aplicar", id: ID, aviso: "Arranjo das telas revertido: o painel não respondeu",
  ida: IDA, volta: VOLTA, alvo: ALVO, antes: ANTES, escalasAntes: { "DP-1": 120, "eDP-1": 150 },
  edp1NaOrigem: true,
}, extra || {})

const tipos = (r) => plain(r.efeitos).map((e) => e.tipo)
const nomeEtapa = (r) => r.estado.nome + "/" + r.estado.etapa

// Runs events in sequence and returns every step's result.
function rodar(estado, eventos) {
  const passos = []
  let atual = estado
  for (const ev of eventos) {
    const r = Fluxo.transicao(atual, ev)
    passos.push(r)
    atual = r.estado
  }
  return passos
}
const ultimo = (passos) => passos[passos.length - 1]
const todosOsTipos = (passos) => passos.flatMap((r) => tipos(r))

const abrir = { tipo: "abrir", edp1Ligado: true }
const editando = () => Fluxo.transicao(Fluxo.estadoInicial(), abrir).estado
const aplicando = () => Fluxo.transicao(editando(), aplicar()).estado
const avaliando = () => Fluxo.transicao(aplicando(), { tipo: "guarda", ok: true }).estado
const lendo = () => Fluxo.transicao(avaliando(), { tipo: "evalRespondeu", saida: "ok\n" }).estado
const confirmando = () => Fluxo.transicao(lendo(), { tipo: "leitura", telas: TELAS_ALVO }).estado

const EFEITOS_REVERTER_CONFIRMANDO = ["fecharConfirmacao", "pararContagem", "eval"]
const EFEITOS_REVERTER_APLICANDO = ["eval"]

test("constantes do spec e da Tarefa 1", () => {
  assert.equal(Fluxo.CONTAGEM_S, 15)
  assert.equal(Fluxo.GUARDA_S, 30)
  assert.equal(Fluxo.LEITURA_MS, 3000)
  assert.equal(Fluxo.LEITURA_PASSO_MS, 250)
  assert.equal(Fluxo.DEBOUNCE_MS, 1500)
  assert.equal(Fluxo.ESPERA_VOLTA_MS, 3000)
})

test("estadoInicial tem a forma do Estado", () => {
  assert.deepEqual(plain(Fluxo.estadoInicial()), {
    nome: "fechado", etapa: "", id: "", ida: "", volta: "", alvo: [], antes: [], portasAlvo: [],
    escalasAntes: {}, restante: 0, dialogo: "", esquecer: "", removidas: {}, ausentes: [],
  })
})

test("abrir, fechar e eDP-1 ligado ou desligado", () => {
  assert.equal(Fluxo.transicao(Fluxo.estadoInicial(), abrir).estado.nome, "editando")
  const so = Fluxo.transicao(Fluxo.estadoInicial(), { tipo: "abrir", edp1Ligado: false })
  assert.equal(so.estado.nome, "somenteLeitura")
  assert.deepEqual(tipos(so), [])
  assert.equal(Fluxo.transicao(editando(), { tipo: "edp1", ligado: false }).estado.nome, "somenteLeitura")
  assert.equal(Fluxo.transicao(so.estado, { tipo: "edp1", ligado: true }).estado.nome, "editando")
  assert.equal(Fluxo.transicao(editando(), { tipo: "fechar" }).estado.nome, "fechado")
  assert.equal(Fluxo.transicao(so.estado, { tipo: "fechar" }).estado.nome, "fechado")
  // somenteLeitura never applies (D13)
  const r = Fluxo.transicao(so.estado, aplicar())
  assert.equal(r.estado.nome, "somenteLeitura")
  assert.deepEqual(tipos(r), [])
})

test("a guarda é armada antes de qualquer eval", () => {
  const r = Fluxo.transicao(editando(), aplicar())
  assert.deepEqual(tipos(r), ["armarGuarda"])
  assert.deepEqual(plain(r.efeitos[0]), { tipo: "armarGuarda", id: ID, aviso: aplicar().aviso, volta: VOLTA })
  assert.equal(nomeEtapa(r), "aplicando/armando")
  assert.equal(r.estado.restante, 15)
  assert.deepEqual(plain(r.estado.portasAlvo), ["DP-1"])
  const g = Fluxo.transicao(r.estado, { tipo: "guarda", ok: true })
  assert.deepEqual(plain(g.efeitos), [{ tipo: "eval", trecho: IDA }])
  assert.equal(nomeEtapa(g), "aplicando/avaliando")
})

test("sem guarda não aplica", () => {
  const passos = rodar(editando(), [aplicar(), { tipo: "guarda", ok: false }])
  const r = ultimo(passos)
  assert.equal(r.estado.nome, "editando")
  assert.deepEqual(plain(r.efeitos), [{ tipo: "avisar", chave: "aviso.semGuarda", args: [] }])
  assert.ok(!todosOsTipos(passos).includes("eval"))
  // nothing that arrives afterwards gets an eval out of it
  const depois = rodar(r.estado, [{ tipo: "guarda", ok: true }, { tipo: "evalRespondeu", saida: "ok" },
                                  { tipo: "leitura", telas: TELAS_ALVO }, { tipo: "tique" }])
  assert.ok(!todosOsTipos(depois).includes("eval"))
  assert.equal(ultimo(depois).estado.nome, "editando")
})

test("Aplicar recusado com o eDP-1 fora de 0x0 ou sem o campo", () => {
  const base = editando()
  for (const valor of [false, undefined, "true", 1]) {
    const ev = aplicar({ edp1NaOrigem: valor })
    if (valor === undefined) delete ev.edp1NaOrigem
    const r = Fluxo.transicao(base, ev)
    assert.equal(r.estado, base, "edp1NaOrigem " + String(valor))
    assert.deepEqual(tipos(r), [])
  }
  assert.deepEqual(tipos(Fluxo.transicao(base, aplicar({ edp1NaOrigem: true }))), ["armarGuarda"])
})

test("Aplicar recusado com trecho vazio, alvo vazio ou id inválido", () => {
  const base = editando()
  const ruins = [
    aplicar({ ida: "" }), aplicar({ volta: "" }), aplicar({ ida: null }), aplicar({ volta: undefined }),
    aplicar({ alvo: [] }), aplicar({ alvo: null }), aplicar({ antes: null }), aplicar({ id: "ABC" }),
    aplicar({ id: "0123456789abcdeg" }),
  ]
  for (const ev of ruins) {
    const r = Fluxo.transicao(base, ev)
    assert.equal(r.estado, base)
    assert.deepEqual(tipos(r), [])
  }
})

test("eval sem efeito ainda passa pela confirmação (D15)", () => {
  // the live state already equals the target: the first read-back matches
  const passos = rodar(editando(), [aplicar(), { tipo: "guarda", ok: true }, { tipo: "evalRespondeu", saida: " ok \n" }])
  assert.deepEqual(plain(ultimo(passos).efeitos), [{ tipo: "lerDeVolta", esperado: ALVO }])
  assert.equal(nomeEtapa(ultimo(passos)), "aplicando/lendo")
  const r = Fluxo.transicao(ultimo(passos).estado, { tipo: "leitura", telas: TELAS_ALVO })
  assert.equal(r.estado.nome, "confirmando")
  assert.equal(r.estado.restante, 15)
  assert.deepEqual(tipos(r), ["mostrarConfirmacao", "iniciarContagem"])
})

test("leitura que ainda não bate espera a próxima", () => {
  const r = Fluxo.transicao(lendo(), { tipo: "leitura", telas: TELAS_OUTRA })
  assert.equal(nomeEtapa(r), "aplicando/lendo")
  assert.deepEqual(tipos(r), [])
})

test("leitura esgotada confirma com o aviso de outra coisa", () => {
  const r = Fluxo.transicao(lendo(), { tipo: "leituraEsgotada", detalhe: "DP-1 em 1000x1000" })
  assert.equal(r.estado.nome, "confirmando")
  assert.deepEqual(plain(r.efeitos), [
    { tipo: "mostrarConfirmacao" }, { tipo: "iniciarContagem" },
    { tipo: "avisar", chave: "aviso.outraCoisa", args: ["DP-1 em 1000x1000"] },
  ])
  const semDetalhe = Fluxo.transicao(lendo(), { tipo: "leituraEsgotada" })
  assert.deepEqual(plain(semDetalhe.efeitos[2]), { tipo: "avisar", chave: "aviso.outraCoisa", args: [""] })
})

test("eval com erro reverte e avisa", () => {
  const r = Fluxo.transicao(avaliando(), { tipo: "evalRespondeu", saida: "error: [string]: x\n" })
  assert.equal(nomeEtapa(r), "revertendo/avaliando")
  assert.deepEqual(plain(r.efeitos), [
    { tipo: "eval", trecho: VOLTA },
    { tipo: "avisar", chave: "aviso.evalFalhou", args: ["error: [string]: x"] },
  ])
  // anything but exactly "ok" after trim is a failure
  for (const saida of ["", "okay", "ok ok", undefined]) {
    assert.equal(Fluxo.transicao(avaliando(), { tipo: "evalRespondeu", saida }).estado.nome, "revertendo")
  }
})

test("Manter desarma e grava, sem reload", () => {
  const r = Fluxo.transicao(confirmando(), { tipo: "manter" })
  assert.equal(r.estado.nome, "gravando")
  assert.deepEqual(plain(r.efeitos), [
    { tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }, { tipo: "desarmarGuarda", id: ID },
    { tipo: "gravarTsv", origem: "manter", chave: "" },
  ])
  assert.ok(!tipos(r).includes("reload") && !tipos(r).includes("eval"))
  const ok = Fluxo.transicao(r.estado, { tipo: "gravou", ok: true })
  assert.equal(ok.estado.nome, "editando")
  assert.deepEqual(tipos(ok), [])
  const falhou = Fluxo.transicao(r.estado, { tipo: "gravou", ok: false })
  assert.equal(falhou.estado.nome, "editando")
  assert.deepEqual(plain(falhou.efeitos), [{ tipo: "avisar", chave: "aviso.naoSalvou", args: [] }])
  // back in editando with nothing pending
  assert.deepEqual(plain(ok.estado), plain(editando()))
})

test("contagem zerada reverte", () => {
  let estado = confirmando()
  for (let i = 0; i < 14; i++) {
    const r = Fluxo.transicao(estado, { tipo: "tique" })
    assert.deepEqual(tipos(r), [])
    estado = r.estado
  }
  assert.equal(estado.nome, "confirmando")
  assert.equal(estado.restante, 1)
  const r = Fluxo.transicao(estado, { tipo: "tique" })
  assert.equal(nomeEtapa(r), "revertendo/avaliando")
  assert.deepEqual(tipos(r), EFEITOS_REVERTER_CONFIRMANDO)
  assert.deepEqual(plain(r.efeitos[2]), { tipo: "eval", trecho: VOLTA })
})

test("Reverter ou fechar na confirmação revertem", () => {
  for (const tipo of ["reverter", "fechar"]) {
    const r = Fluxo.transicao(confirmando(), { tipo })
    assert.equal(nomeEtapa(r), "revertendo/avaliando")
    assert.deepEqual(tipos(r), EFEITOS_REVERTER_CONFIRMANDO)
  }
})

test("evento de outra porta na confirmação reverte", () => {
  for (const nome of ["monitorremovedv2", "monitoraddedv2"]) {
    const r = Fluxo.transicao(confirmando(), { tipo: "tela", nome, porta: "HDMI-A-4" })
    assert.equal(nomeEtapa(r), "revertendo/avaliando")
    assert.deepEqual(plain(r.efeitos), [
      { tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }, { tipo: "eval", trecho: VOLTA },
      { tipo: "avisar", chave: "aviso.telaMudou", args: [] },
    ])
  }
  // and in aplicando too
  const a = Fluxo.transicao(lendo(), { tipo: "tela", nome: "monitorremovedv2", porta: "eDP-1" })
  assert.equal(nomeEtapa(a), "revertendo/avaliando")
  assert.deepEqual(tipos(a), [...EFEITOS_REVERTER_APLICANDO, "avisar"])
})

test("configreloaded na confirmação desarma e avisa, sem eval", () => {
  const r = Fluxo.transicao(confirmando(), { tipo: "configRecarregada" })
  assert.equal(r.estado.nome, "editando")
  assert.deepEqual(plain(r.efeitos), [
    { tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }, { tipo: "desarmarGuarda", id: ID },
    { tipo: "avisar", chave: "aviso.recarregadoNaConfirmacao", args: [] },
  ])
})

test("configreloaded em aplicando reverte", () => {
  for (const estado of [aplicando(), avaliando(), lendo()]) {
    const r = Fluxo.transicao(estado, { tipo: "configRecarregada" })
    assert.equal(nomeEtapa(r), "revertendo/avaliando")
    assert.deepEqual(plain(r.efeitos), [
      { tipo: "eval", trecho: VOLTA },
      { tipo: "avisar", chave: "aviso.recarregadoNaConfirmacao", args: [] },
    ])
  }
})

test("Aplicar duplo é ignorado", () => {
  for (const estado of [aplicando(), avaliando(), lendo(), confirmando(),
                        Fluxo.transicao(confirmando(), { tipo: "manter" }).estado,
                        Fluxo.transicao(confirmando(), { tipo: "reverter" }).estado,
                        Fluxo.estadoInicial()]) {
    const r = Fluxo.transicao(estado, aplicar({ id: "fedcba9876543210" }))
    assert.equal(r.estado, estado)
    assert.deepEqual(tipos(r), [])
  }
})

test("leitura com escala mudada vira falha e reverte", () => {
  // matches the target, but DP-1 came back at 1.25
  const r = Fluxo.transicao(lendo(), { tipo: "leitura", telas: [EDP1, tela("DP-1", 2560, 0, 150)] })
  assert.equal(nomeEtapa(r), "revertendo/avaliando")
  assert.deepEqual(plain(r.efeitos), [
    { tipo: "eval", trecho: VOLTA },
    { tipo: "avisar", chave: "aviso.escalaMudou", args: ["DP-1"] },
  ])
})

test("porta do alvo que some e volta dentro da espera não reverte", () => {
  for (const inicio of [lendo, confirmando]) {
    const estado = inicio()
    const fora = Fluxo.transicao(estado, { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" })
    assert.equal(fora.estado.nome, estado.nome)
    assert.equal(fora.estado.etapa, estado.etapa)
    assert.deepEqual(plain(fora.efeitos), [{ tipo: "esperarVolta", porta: "DP-1", ms: 3000 }])
    assert.deepEqual(plain(fora.estado.removidas), { "DP-1": true })
    const volta = Fluxo.transicao(fora.estado, { tipo: "tela", nome: "monitoraddedv2", porta: "DP-1" })
    assert.deepEqual(plain(volta.efeitos), [{ tipo: "cancelarEspera", porta: "DP-1" }])
    assert.deepEqual(plain(volta.estado.removidas), {})
    assert.equal(volta.estado.nome, estado.nome)
    // a late semVolta after the port came back does nothing
    const tarde = Fluxo.transicao(volta.estado, { tipo: "semVolta", porta: "DP-1" })
    assert.equal(tarde.estado, volta.estado)
    assert.deepEqual(tipos(tarde), [])
  }
  // an added event of a target port that was never removed changes nothing
  const c = confirmando()
  const r = Fluxo.transicao(c, { tipo: "tela", nome: "monitoraddedv2", porta: "DP-1" })
  assert.deepEqual(tipos(r), [])
  assert.deepEqual(plain(r.estado), plain(c))
  // and the countdown keeps running while the port is away
  const fora = Fluxo.transicao(c, { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" }).estado
  assert.equal(Fluxo.transicao(fora, { tipo: "tique" }).estado.restante, 14)
})

test("alvo removido e sem volta restaura a regra da porta ausente", () => {
  // I2 (re-review N1): the only target port left and did not come back. The volta still goes, with
  // the values of `antes` for that port (the ida put its rule last, so restoring it changes nothing
  // for a screen another service switched off), and nothing ever reloads.
  assert.match(VOLTA, /output = "DP-1", mode = "1920x1080@60\.00", position = "2048x36", transform = 0/)
  assert.doesNotMatch(VOLTA, /scale|disabled|mirror/)
  for (const inicio of [confirmando, lendo]) {
    const passos = rodar(inicio(), [
      { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" },
      { tipo: "semVolta", porta: "DP-1" },
    ])
    const r = ultimo(passos)
    assert.equal(nomeEtapa(r), "revertendo/avaliando")
    const fechar = inicio === confirmando ? [{ tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }] : []
    // the notice about the screen that left comes at the end and says more
    assert.deepEqual(plain(r.efeitos), fechar.concat([{ tipo: "eval", trecho: VOLTA }]))
    // nothing present to read back: the eval answer ends it
    const fim = Fluxo.transicao(r.estado, { tipo: "evalRespondeu", saida: "ok" })
    assert.equal(fim.estado.nome, "editando")
    assert.deepEqual(plain(fim.efeitos), [
      { tipo: "desarmarGuarda", id: ID }, { tipo: "avisar", chave: "aviso.revertidoSemTela", args: ["DP-1"] },
    ])
    // a refused volta takes the failure path that was there: still no reload with a port away
    const recusada = Fluxo.transicao(r.estado, { tipo: "evalRespondeu", saida: "error: x" })
    assert.equal(recusada.estado.nome, "editando")
    assert.deepEqual(tipos(recusada), ["desarmarGuarda", "avisar"])
    const todos = todosOsTipos(passos.concat([fim, recusada]))
    assert.ok(!todos.includes("reload"), todos.join(","))
    // late answers change nothing
    const tarde = rodar(fim.estado, [{ tipo: "evalRespondeu", saida: "ok" }, { tipo: "leituraEsgotada" }, { tipo: "recarregou" }])
    assert.deepEqual(todosOsTipos(tarde), [])
  }
  // semVolta of a port that is not away is ignored
  const c = confirmando()
  assert.equal(Fluxo.transicao(c, { tipo: "semVolta", porta: "DP-1" }).estado, c)
})

test("Esquecer grava só depois do diálogo e nunca abre contagem", () => {
  const ed = editando()
  const pedido = Fluxo.transicao(ed, { tipo: "esquecerPedido", chave: "desc:" + RTK })
  assert.equal(pedido.estado.nome, "editando")
  assert.equal(pedido.estado.dialogo, "esquecer")
  assert.deepEqual(plain(pedido.efeitos), [{ tipo: "mostrarEsquecer", chave: "desc:" + RTK }])
  // Aplicar and a second request are ignored while the dialog is open
  assert.equal(Fluxo.transicao(pedido.estado, aplicar()).estado, pedido.estado)
  assert.equal(Fluxo.transicao(pedido.estado, { tipo: "esquecerPedido", chave: "x" }).estado, pedido.estado)
  // Cancel writes nothing
  const cancelado = Fluxo.transicao(pedido.estado, { tipo: "esquecerCancelado" })
  assert.deepEqual(plain(cancelado.efeitos), [{ tipo: "fecharEsquecer" }])
  assert.deepEqual(plain(cancelado.estado), plain(ed))
  // Confirm writes, with no eval and no countdown
  const passos = rodar(ed, [
    { tipo: "esquecerPedido", chave: "desc:" + RTK }, { tipo: "esquecerConfirmado" }, { tipo: "gravou", ok: true },
  ])
  assert.deepEqual(plain(passos[1].efeitos), [
    { tipo: "fecharEsquecer" }, { tipo: "gravarTsv", origem: "esquecer", chave: "desc:" + RTK },
  ])
  assert.equal(passos[1].estado.nome, "gravando")
  assert.equal(ultimo(passos).estado.nome, "editando")
  const todos = todosOsTipos(passos)
  for (const proibido of ["eval", "iniciarContagem", "mostrarConfirmacao", "armarGuarda"]) {
    assert.ok(!todos.includes(proibido), proibido)
  }
  // no dialog open: confirm and cancel are ignored
  assert.equal(Fluxo.transicao(ed, { tipo: "esquecerConfirmado" }).estado, ed)
  assert.equal(Fluxo.transicao(ed, { tipo: "esquecerCancelado" }).estado, ed)
})

test("revertendo com leitura que bate desarma", () => {
  const passos = rodar(confirmando(), [
    { tipo: "reverter" }, { tipo: "evalRespondeu", saida: "ok" }, { tipo: "leitura", telas: TELAS_ALVO },
  ])
  assert.deepEqual(plain(passos[1].efeitos), [{ tipo: "lerDeVolta", esperado: ANTES }])
  assert.equal(nomeEtapa(passos[2]), "revertendo/lendo")
  const r = Fluxo.transicao(passos[2].estado, { tipo: "leitura", telas: TELAS_ANTES })
  assert.equal(r.estado.nome, "editando")
  assert.deepEqual(plain(r.efeitos), [{ tipo: "desarmarGuarda", id: ID }])
  assert.deepEqual(plain(r.estado), plain(editando()))
})

test("revertendo sem leitura que bata recarrega e só então desarma", () => {
  const passos = rodar(confirmando(), [
    { tipo: "reverter" }, { tipo: "evalRespondeu", saida: "ok" }, { tipo: "leitura", telas: TELAS_OUTRA },
    { tipo: "leituraEsgotada" },
  ])
  const esgotou = ultimo(passos)
  assert.equal(nomeEtapa(esgotou), "revertendo/recarregando")
  assert.deepEqual(plain(esgotou.efeitos), [{ tipo: "reload" }])
  assert.ok(!todosOsTipos(passos).includes("desarmarGuarda"))
  const r = Fluxo.transicao(esgotou.estado, { tipo: "recarregou" })
  assert.equal(r.estado.nome, "editando")
  assert.deepEqual(plain(r.efeitos), [
    { tipo: "desarmarGuarda", id: ID }, { tipo: "avisar", chave: "aviso.recarregou", args: [] },
  ])
  // a failed revert eval goes straight to the reload
  const falhou = rodar(confirmando(), [{ tipo: "reverter" }, { tipo: "evalRespondeu", saida: "error: x" }])
  assert.equal(nomeEtapa(ultimo(falhou)), "revertendo/recarregando")
  assert.deepEqual(tipos(ultimo(falhou)), ["reload"])
})

test("eventos fora de hora e desconhecidos não mudam nada", () => {
  const casos = [
    [Fluxo.estadoInicial(), { tipo: "fechar" }],
    [Fluxo.estadoInicial(), { tipo: "tique" }],
    [editando(), { tipo: "abrir", edp1Ligado: true }],
    [editando(), { tipo: "manter" }],
    [editando(), { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" }],
    [editando(), { tipo: "configRecarregada" }],
    [aplicando(), { tipo: "fechar" }],
    [aplicando(), { tipo: "evalRespondeu", saida: "ok" }],
    [avaliando(), { tipo: "guarda", ok: true }],
    [confirmando(), { tipo: "esquecerPedido", chave: "x" }],
    [confirmando(), { tipo: "tela", nome: "outroEvento", porta: "HDMI-A-4" }],
    [editando(), { tipo: "inventado" }],
    [editando(), null],
    [editando(), "abrir"],
  ]
  for (const [estado, evento] of casos) {
    const r = Fluxo.transicao(estado, evento)
    assert.equal(r.estado, estado, JSON.stringify(evento))
    assert.deepEqual(tipos(r), [])
  }
})

test("transicao não muda o estado de entrada", () => {
  const eventos = [
    abrir, aplicar(), { tipo: "guarda", ok: true }, { tipo: "evalRespondeu", saida: "ok" },
    { tipo: "leitura", telas: TELAS_ALVO }, { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" },
    { tipo: "tique" }, { tipo: "tela", nome: "monitoraddedv2", porta: "DP-1" },
    { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" }, { tipo: "semVolta", porta: "DP-1" },
    { tipo: "evalRespondeu", saida: "ok" }, { tipo: "leituraEsgotada" }, { tipo: "recarregou" },
    { tipo: "esquecerPedido", chave: "k" }, { tipo: "esquecerConfirmado" }, { tipo: "gravou", ok: false },
    aplicar(), { tipo: "guarda", ok: true }, { tipo: "configRecarregada" },
  ]
  let estado = Fluxo.estadoInicial()
  for (const ev of eventos) {
    const antesEstado = JSON.stringify(estado)
    const antesEvento = JSON.stringify(ev)
    const r = Fluxo.transicao(estado, ev)
    assert.equal(JSON.stringify(estado), antesEstado, "estado mudou em " + ev.tipo)
    assert.equal(JSON.stringify(ev), antesEvento, "evento mudou em " + ev.tipo)
    // the next state does not share the event's arrays
    if (ev.tipo === "aplicar") {
      assert.notEqual(r.estado.alvo, ev.alvo)
      assert.notEqual(r.estado.escalasAntes, ev.escalasAntes)
    }
    estado = r.estado
  }
  assert.equal(nomeEtapa({ estado }), "revertendo/avaliando")
})

test("toda chave de avisar existe no catálogo", () => {
  const catalogo = JSON.parse(readFileSync(new URL("../i18n/pt-BR.json", import.meta.url), "utf8"))
  const fonte = readFileSync(new URL("../Fluxo.js", import.meta.url), "utf8")
  const chaves = [...fonte.matchAll(/"(aviso\.[A-Za-z]+)"/g)].map((m) => m[1])
  assert.ok(chaves.length >= 8)
  for (const chave of chaves) assert.ok(Object.hasOwn(catalogo, chave), chave)
})

test("novoId dá 16 hex", () => {
  const seq = [0.1, 0.9]; let i = 0
  assert.match(Fluxo.novoId(() => seq[i++ % 2]), /^[0-9a-f]{16}$/)
  assert.equal(Fluxo.novoId(() => 0), "0000000000000000")
  // a generator that hits 1 or misbehaves still yields 16 hex
  assert.match(Fluxo.novoId(() => 1), /^[0-9a-f]{16}$/)
  assert.match(Fluxo.novoId(() => NaN), /^[0-9a-f]{16}$/)
  assert.match(Fluxo.novoId(() => -3), /^[0-9a-f]{16}$/)
})

// ---- Tarefa 8: reconciler, auto-open, event port, gap warning (spec 8.7, Rulings 8 and 16) ----

const Geo = carregar("Geometria.js")
const Dados = carregar("Dados.js")
const MONITORES = JSON.parse(fixture("monitores-3telas.json"))
const REGRAS = Dados.regrasDoMonitorsLua(fixture("monitors.lua"))
const LG = "LG Electronics LG ULTRAWIDE 0x0003B53D"
const NOVA = "Fabricante Inventado Tela Nova 0x0001"
const OUTRA = "Fabricante Inventado Outra Tela 0x0002"
const PROIBIDO = /scale|disabled|mirror/

// Raw screens (telas + fora) from the fixture: `mudar` maps a fixture name to
// hyprctl field overrides (name, description, x, y) or null to unplug it;
// `depois` maps the resulting port to Tela field overrides.
function vivas(mudar, depois) {
  const lista = []
  for (const m of MONITORES) {
    const troca = mudar && Object.hasOwn(mudar, m.name) ? mudar[m.name] : {}
    if (troca === null) continue
    lista.push(Object.assign({}, m, troca))
  }
  const r = Geo.lerMonitores(JSON.stringify(lista), REGRAS)
  assert.equal(r.ok, true)
  return r.telas.concat(r.fora).map((t) => Object.assign(t, depois && depois[t.porta] ? depois[t.porta] : {}))
}
const SEM_LG = { "HDMI-A-4": null }
const linha = (desc, porta, modo, x, y) => ({ desc, porta, modo, x, y, transform: 0, visto: "2026-11-20" })
const PORTATIL_DP1 = linha(RTK, "DP-1", "1920x1080@60.00", 2048, 36)
const PORTATIL_HDMI = linha(RTK, "HDMI-A-4", "1920x1080@60.00", 2048, 36)
const reconciliar = (v, salvo, extra) => plain(Fluxo.reconciliar(v, salvo, REGRAS, (extra && extra.neutralizadas) || {},
  extra && "edp1Ligado" in extra ? extra.edp1Ligado : true, (extra && extra.estado) || "fechado",
  (extra && extra.aplicadas) || {}))

test("reconciliar: uma linha para cada caso do §8.7", () => {
  // (a) portátil conhecida na DP-1, a porta dela
  assert.deepEqual(reconciliar(vivas(SEM_LG), [PORTATIL_DP1]), [])
  // (a) conhecida na própria porta com valores diferentes do salvo: nada (é o "diferente do salvo" do D15)
  assert.deepEqual(reconciliar(vivas(SEM_LG), [linha(RTK, "DP-1", "1920x1080@60.00", 2560, 0)]), [])
  // (b) LG sem linha no TSV mas com regra desc:, nada de preferred nem posição
  assert.deepEqual(reconciliar(vivas(), [PORTATIL_DP1]), [])
  assert.deepEqual(reconciliar(vivas(), null), [])
  // (c) portátil conhecida na HDMI-A-4 (o LG fora), com a linha dela na DP-1
  const c = reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4", x: -256, y: -1080 } }), [PORTATIL_DP1])
  assert.deepEqual(c, [{
    tipo: "aplicarSalvo", porta: "HDMI-A-4", desc: RTK,
    trecho: 'hl.monitor({ output = "desc:' + RTK + '", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })\n'
          + 'hl.monitor({ output = "HDMI-A-4", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })',
    esperado: [{ porta: "HDMI-A-4", modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0 }],
    volta: 'hl.monitor({ output = "HDMI-A-4", mode = "1920x1080@60.00", position = "-256x-1080", transform = 0 })',
    esperadoVolta: [{ porta: "HDMI-A-4", modo: "1920x1080@60.00", x: -256, y: -1080, transform: 0 }],
  }])
  // (c) também quando a linha dela está sem porta ("-")
  const semDono = reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4", x: -256, y: -1080 } }),
                              [linha(RTK, "-", "1920x1080@60.00", 2048, 36)])
  assert.deepEqual(semDono.map((a) => a.tipo + " " + a.porta), ["aplicarSalvo HDMI-A-4"])
  // (d) tela desconhecida na DP-1
  const d = reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } }), [PORTATIL_DP1])
  assert.deepEqual(d, [{
    tipo: "neutralizar", porta: "DP-1", desc: NOVA,
    trecho: 'hl.monitor({ output = "DP-1", mode = "preferred", transform = 0 })',
    volta: 'hl.monitor({ output = "DP-1", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })',
    antes: { modo: "1920x1080@60.00", transform: 0 },
    esperadoVolta: [{ porta: "DP-1", modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0 }],
  }])
  // (e) externa na DP-2 sem regra, conhecida ou não
  assert.deepEqual(reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { name: "DP-2", description: NOVA } }), [PORTATIL_DP1]), [])
  assert.deepEqual(reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { name: "DP-2" } }), [PORTATIL_DP1]), [])
  // (f) desconhecida na DP-1, desligada ou espelhada
  const nova = { "HDMI-A-4": null, "DP-1": { description: NOVA } }
  assert.deepEqual(reconciliar(vivas(nova, { "DP-1": { ligada: false } }), [PORTATIL_DP1]), [])
  assert.deepEqual(reconciliar(vivas(nova, { "DP-1": { espelho: true } }), [PORTATIL_DP1]), [])
  // (g) eDP-1: tem regra de porta, não tem linha nem regra desc:, e mesmo assim nada
  assert.deepEqual(reconciliar(vivas({ "HDMI-A-4": null, "DP-1": null }), []), [])
  // nenhum trecho leva escala, desligamento ou espelho
  for (const a of c.concat(d)) {
    assert.doesNotMatch(a.trecho, PROIBIDO)
    if (a.volta) assert.doesNotMatch(a.volta, PROIBIDO)
  }
})

test("reconciliar com o eDP-1 desligado devolve lista vazia (D13)", () => {
  const nova = { "HDMI-A-4": null, "DP-1": { description: NOVA } }
  assert.equal(reconciliar(vivas(nova), []).length, 1)
  assert.deepEqual(reconciliar(vivas(nova), [], { edp1Ligado: false }), [])
  assert.deepEqual(reconciliar(vivas(nova), [], { edp1Ligado: undefined }), [])
  assert.deepEqual(reconciliar(vivas(nova, { "eDP-1": { ligada: false } }), []), [])
  assert.deepEqual(reconciliar(vivas(Object.assign({ "eDP-1": null }, nova)), []), [])
  // eDP-1 fora de 0x0 nos dados crus: nada, como o Aplicar (D4)
  assert.deepEqual(reconciliar(vivas(Object.assign({ "eDP-1": { x: 10, y: 0 } }, nova)), []), [])
  assert.deepEqual(reconciliar(vivas(Object.assign({ "eDP-1": { x: 0, y: -5 } }, nova)), []), [])
})

test("reconciliar em aplicando ou confirmando devolve lista vazia (I14)", () => {
  const nova = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } })
  for (const estado of ["aplicando", "confirmando"]) assert.deepEqual(reconciliar(nova, [], { estado }), [])
  for (const estado of ["fechado", "editando", "somenteLeitura"]) assert.equal(reconciliar(nova, [], { estado }).length, 1)
  const errada = vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4" } })
  assert.deepEqual(reconciliar(errada, [PORTATIL_DP1], { estado: "confirmando" }), [])
})

test("reconciliar é idempotente com neutralizadas", () => {
  const nova = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } })
  const primeira = reconciliar(nova, [PORTATIL_DP1])
  assert.deepEqual(primeira.map((a) => a.tipo), ["neutralizar"])
  // a raiz guarda porta -> desc; o mesmo arranjo (ou os eventos da própria neutralização) não age de novo
  const neutralizadas = { [primeira[0].porta]: primeira[0].desc }
  assert.deepEqual(reconciliar(nova, [PORTATIL_DP1], { neutralizadas }), [])
  const depois = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA, x: 2048, y: 0 } })
  assert.deepEqual(reconciliar(depois, [PORTATIL_DP1], { neutralizadas }), [])
  // configreloaded limpou a memória: neutraliza de novo
  assert.deepEqual(reconciliar(nova, [PORTATIL_DP1], { neutralizadas: {} }).map((a) => a.tipo), ["neutralizar"])
  // outra tela desconhecida na mesma porta não é a neutralizada
  const outra = vivas({ "HDMI-A-4": null, "DP-1": { description: OUTRA } })
  assert.deepEqual(reconciliar(outra, [PORTATIL_DP1], { neutralizadas }).map((a) => a.desc), [OUTRA])
  // memória com chave de protótipo não engana
  assert.equal(reconciliar(nova, [PORTATIL_DP1], { neutralizadas: Object.create({ "DP-1": NOVA }) }).length, 1)
})

test("aplicarSalvo não sai quando a tela já está com os valores salvos", () => {
  const naHdmi = (x, y) => vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4", x, y } })
  assert.deepEqual(reconciliar(naHdmi(2048, 36), [PORTATIL_DP1]), [])
  // taxa salva arredondada (60 contra 60.00 ao vivo) não é diferença (Ruling 14)
  assert.deepEqual(reconciliar(naHdmi(2048, 36), [linha(RTK, "DP-1", "1920x1080@60", 2048, 36)]), [])
  // 59.94 salvo contra 60.00 ao vivo continua sendo troca de modo
  const modo = reconciliar(naHdmi(2048, 36), [linha(RTK, "DP-1", "1920x1080@59.94", 2048, 36)])
  assert.deepEqual(modo.map((a) => a.tipo), ["aplicarSalvo"])
  assert.match(modo[0].trecho, /mode = "1920x1080@59\.94"/)
  // transform diferente também age
  assert.equal(reconciliar(naHdmi(2048, 36), [Object.assign({}, PORTATIL_DP1, { transform: 1 })]).length, 1)
  // o LG na DP-1 com @75 salvo contra 74.99 ao vivo, na posição salva: nada
  const lgNaDp1 = vivas({ "DP-1": null, "HDMI-A-4": { name: "DP-1" } })
  assert.deepEqual(reconciliar(lgNaDp1, [linha(LG, "HDMI-A-4", "2560x1080@75", -256, -1080)]), [])
  assert.equal(reconciliar(lgNaDp1, [linha(LG, "HDMI-A-4", "2560x1080@60.00", -256, -1080)]).length, 1)
})

test("concluirNeutralizacao com escala mudada é falha (D17)", () => {
  const depois = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA, x: 3000, y: 0 } })
  const mudou = depois.map((t) => (t.porta === "DP-1" ? Object.assign({}, t, { escala120: 150 }) : t))
  assert.deepEqual(plain(Fluxo.concluirNeutralizacao(mudou, "DP-1", { "DP-1": 120, "eDP-1": 150 }, REGRAS)),
                   { falha: true, trecho: "" })
  // a escala de outra tela que mudou também é falha (I17)
  const outra = depois.map((t) => (t.porta === "eDP-1" ? Object.assign({}, t, { escala120: 192 }) : t))
  assert.equal(Fluxo.concluirNeutralizacao(outra, "DP-1", { "DP-1": 120, "eDP-1": 150 }, REGRAS).falha, true)
  // sem a escala anterior da porta não há como conferir: falha
  assert.equal(Fluxo.concluirNeutralizacao(depois, "DP-1", {}, REGRAS).falha, true)
  assert.equal(Fluxo.concluirNeutralizacao(depois, "DP-1", null, REGRAS).falha, true)
  // porta sem regra (não dá para mesclar a posição) é falha
  const semRegra = Object.assign(Object.create(null), REGRAS)
  delete semRegra["DP-1"]
  assert.equal(Fluxo.concluirNeutralizacao(depois, "DP-1", { "DP-1": 120 }, semRegra).falha, true)
})

test("concluirNeutralizacao sem falha põe a tela na proposta sem vão", () => {
  // the preferred mode came back and Hyprland kept the old spot, with a gap to the eDP-1
  const depois = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA, x: 3000, y: 0 } })
  const r = plain(Fluxo.concluirNeutralizacao(depois, "DP-1", { "DP-1": 120, "eDP-1": 150 }, REGRAS))
  assert.deepEqual(r, {
    falha: false,
    trecho: 'hl.monitor({ output = "DP-1", mode = "1920x1080@60.00", position = "2048x0", transform = 0 })',
    esperado: [{ porta: "DP-1", modo: "1920x1080@60.00", x: 2048, y: 0, transform: 0 }],
  })
  assert.doesNotMatch(r.trecho, /desc:|auto|scale/)
  // the snippet always says transform 0, even if the read-back still shows another one
  const girada = depois.map((t) => (t.porta === "DP-1" ? Object.assign({}, t, { transform: 1 }) : t))
  assert.match(Fluxo.concluirNeutralizacao(girada, "DP-1", { "DP-1": 120 }, REGRAS).trecho, /transform = 0 \}\)$/)
  // the arrangement with the proposal has no gap and no overlap
  const posta = depois.map((t) => (t.porta === "DP-1" ? Object.assign({}, t, { x: 2048, y: 0 }) : t))
  const v = Geo.validar(posta.filter((t) => t.ligada && !t.espelho), [])
  assert.equal(v.bloqueia, false)
  assert.deepEqual(plain(v.ilhas), [])
  // a screen sitting on the eDP-1 goes to a free spot too
  const emCima = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA, x: 100, y: 100 } })
  const r2 = Fluxo.concluirNeutralizacao(emCima, "DP-1", { "DP-1": 120 }, REGRAS)
  assert.equal(r2.falha, false)
  const pos = /position = "(-?\d+)x(-?\d+)"/.exec(r2.trecho)
  const posta2 = emCima.map((t) => (t.porta === "DP-1" ? Object.assign({}, t, { x: Number(pos[1]), y: Number(pos[2]) }) : t))
  assert.equal(Geo.validar(posta2, []).bloqueia, false)
  // the screen left before the read: nothing to do, and no failure notice
  assert.deepEqual(plain(Fluxo.concluirNeutralizacao(vivas({ "HDMI-A-4": null, "DP-1": null }), "DP-1", { "DP-1": 120 }, REGRAS)),
                   { falha: false, trecho: "" })
  // internal or hostile port: never a snippet
  assert.equal(Fluxo.concluirNeutralizacao(depois, "eDP-1", { "eDP-1": 150 }, REGRAS).trecho, "")
  assert.equal(Fluxo.concluirNeutralizacao(depois, 'DP-1", x = "', { 'DP-1", x = "': 120 }, REGRAS).trecho, "")
})

// decidirAbertura input with the panel closed, eDP-1 on, file saved and nothing offered.
const entrada = (v, extra) => Object.assign({
  gatilho: "monitoraddedv2", vivas: v, salvo: [PORTATIL_DP1], regras: REGRAS, regrasAntes: REGRAS,
  oferecidas: [], conhecidasSemArquivo: [], estado: "fechado", travada: false, edp1Ligado: true, painelAberto: false,
}, extra || {})
const decidir = (v, extra) => plain(Fluxo.decidirAbertura(entrada(v, extra)))
const NOVA_DP1 = { "HDMI-A-4": null, "DP-1": { description: NOVA } }

test("decidirAbertura: tela desconhecida abre e entra em oferecidas", () => {
  assert.deepEqual(decidir(vivas(NOVA_DP1)),
                   { abrir: true, porta: "DP-1", notificacoes: [], oferecidas: ["desc:" + NOVA] })
  assert.equal(decidir(vivas(NOVA_DP1), { gatilho: "partida" }).abrir, true)
  // numa porta sem regra também abre (faixa da D11), ao contrário do reconciliador
  const semRegra = decidir(vivas({ "HDMI-A-4": null, "DP-1": { name: "DP-2", description: NOVA } }))
  assert.equal(semRegra.abrir, true)
  assert.equal(semRegra.porta, "DP-2")
  // duas novas: abre na primeira e as duas entram em oferecidas
  const duas = decidir(vivas({ "DP-1": { description: NOVA }, "HDMI-A-4": { description: OUTRA } }))
  assert.equal(duas.porta, "DP-1")
  assert.deepEqual(duas.oferecidas, ["desc:" + NOVA, "desc:" + OUTRA])
  // o painel já aberto (editando) também seleciona a nova
  assert.equal(decidir(vivas(NOVA_DP1), { estado: "editando", painelAberto: true }).abrir, true)
})

test("decidirAbertura: tela conhecida não abre, inclusive a que só tem regra desc:", () => {
  assert.deepEqual(decidir(vivas(SEM_LG)), { abrir: false, porta: "", notificacoes: [], oferecidas: [] })
  // o LG sem linha no TSV, só com a regra desc: do monitors.lua
  assert.equal(decidir(vivas()).abrir, false)
  // o eDP-1 nunca é candidato
  assert.equal(decidir(vivas({ "HDMI-A-4": null, "DP-1": null }), { salvo: [] }).abrir, false)
  // desligada ou espelhada também não
  assert.equal(decidir(vivas(NOVA_DP1, { "DP-1": { ligada: false } })).abrir, false)
  assert.equal(decidir(vivas(NOVA_DP1, { "DP-1": { espelho: true } })).abrir, false)
})

test("decidirAbertura: já oferecida não abre; sai da lista quando a tela sai", () => {
  const ja = decidir(vivas(NOVA_DP1), { oferecidas: ["desc:" + NOVA] })
  assert.equal(ja.abrir, false)
  assert.deepEqual(ja.oferecidas, ["desc:" + NOVA])
  // the screen left: the key goes, so plugging it back offers it again
  const saiu = decidir(vivas(SEM_LG), { oferecidas: ["desc:" + NOVA] })
  assert.deepEqual(saiu.oferecidas, [])
  assert.equal(decidir(vivas(NOVA_DP1), { oferecidas: saiu.oferecidas }).abrir, true)
  // a screen switched off is still plugged in: its key stays
  assert.deepEqual(decidir(vivas(NOVA_DP1, { "DP-1": { ligada: false } }), { oferecidas: ["desc:" + NOVA] }).oferecidas,
                   ["desc:" + NOVA])
  // input list is not changed
  const lista = ["desc:" + NOVA]
  Fluxo.decidirAbertura(entrada(vivas(SEM_LG), { oferecidas: lista }))
  assert.deepEqual(lista, ["desc:" + NOVA])
})

test("decidirAbertura: em confirmando, com o eDP-1 desligado ou travada não abre", () => {
  const nao = { abrir: false, porta: "", notificacoes: [], oferecidas: [] }
  for (const estado of ["aplicando", "confirmando"]) assert.deepEqual(decidir(vivas(NOVA_DP1), { estado, painelAberto: true }), nao)
  assert.deepEqual(decidir(vivas(NOVA_DP1), { edp1Ligado: false }), nao)
  assert.deepEqual(decidir(vivas(NOVA_DP1), { edp1Ligado: undefined }), nao)
  // locked: does not open and does not use the offer up, the next monitoraddedv2 opens
  assert.deepEqual(decidir(vivas(NOVA_DP1), { travada: true }), nao)
  assert.deepEqual(decidir(vivas(NOVA_DP1), { travada: "erro" }), nao)
  assert.equal(decidir(vivas(NOVA_DP1), { travada: false }).abrir, true)
})

test("decidirAbertura: sem arquivo, as conhecidas sem arquivo não abrem", () => {
  const semArquivo = { salvo: null, conhecidasSemArquivo: ["desc:" + NOVA] }
  assert.equal(decidir(vivas(NOVA_DP1), semArquivo).abrir, false)
  // a different screen, not there at startup, opens
  assert.equal(decidir(vivas({ "HDMI-A-4": null, "DP-1": { description: OUTRA } }), semArquivo).abrir, true)
  // with a file, the set no longer matters
  assert.equal(decidir(vivas(NOVA_DP1), { conhecidasSemArquivo: ["desc:" + NOVA] }).abrir, true)
})

test("decidirAbertura: configreloaded nunca abre", () => {
  for (const gatilho of ["configreloaded", "monitorsLua", "outro", undefined]) {
    const r = decidir(vivas(NOVA_DP1), { gatilho })
    assert.equal(r.abrir, false, String(gatilho))
    assert.deepEqual(r.oferecidas, [], String(gatilho))
  }
})

test("decidirAbertura: porta que ganhou regra notifica com o painel fechado e nunca abre (S3)", () => {
  const comDp2 = Object.assign(Object.create(null), REGRAS)
  comDp2["DP-2"] = { modo: "preferred", posicao: "auto", escala: 1, transform: 0 }
  // the portable on DP-2: known by its desc: rule, so the notice is the only thing that happens
  const naDp2 = vivas({ "HDMI-A-4": null, "DP-1": { name: "DP-2" } })
  for (const gatilho of ["configreloaded", "monitorsLua"]) {
    assert.deepEqual(decidir(naDp2, { gatilho, regras: comDp2 }),
                     { abrir: false, porta: "", notificacoes: [{ chave: "notif.regraCriada", args: ["DP-2"] }], oferecidas: [] })
  }
  // an unknown screen there: notice too, still no auto-open on configreloaded
  const novaDp2 = decidir(vivas({ "HDMI-A-4": null, "DP-1": { name: "DP-2", description: NOVA } }),
                          { gatilho: "configreloaded", regras: comDp2 })
  assert.equal(novaDp2.abrir, false)
  assert.deepEqual(novaDp2.notificacoes, [{ chave: "notif.regraCriada", args: ["DP-2"] }])
  // panel open: no notice (the screen just becomes movable there)
  assert.deepEqual(decidir(naDp2, { gatilho: "configreloaded", regras: comDp2, painelAberto: true }).notificacoes, [])
  // rule that was already there, or no baseline yet: no notice
  assert.deepEqual(decidir(naDp2, { gatilho: "configreloaded", regras: comDp2, regrasAntes: comDp2 }).notificacoes, [])
  assert.deepEqual(decidir(naDp2, { gatilho: "configreloaded", regras: comDp2, regrasAntes: null }).notificacoes, [])
  // screen switched off: no notice
  assert.deepEqual(decidir(vivas({ "HDMI-A-4": null, "DP-1": { name: "DP-2" } }, { "DP-2": { ligada: false } }),
                           { gatilho: "configreloaded", regras: comDp2 }).notificacoes, [])
})

test("portaDoEvento lê o segundo campo e recusa porta inválida", () => {
  assert.equal(Fluxo.portaDoEvento("1,DP-1,Invalid Vendor Codename - RTK FHD demoset-1"), "DP-1")
  assert.equal(Fluxo.portaDoEvento('1,DP-1"x,y'), "")
  // a desc with commas still gives the second field
  assert.equal(Fluxo.portaDoEvento("3,HDMI-A-4,LG, com, vírgulas"), "HDMI-A-4")
  assert.equal(Fluxo.portaDoEvento("2,eDP-1,AU Optronics 0x1396"), "eDP-1")
  for (const ruim of ["DP-1", "", "1,,x", "1,-,x", "1,DP 1,x", "1," + "A".repeat(33) + ",x", null, undefined, 7, {}]) {
    assert.equal(Fluxo.portaDoEvento(ruim), "", String(ruim))
  }
})

test("avisoDeVao avisa uma vez por arranjo com vão", () => {
  // the fixture as it is: eDP-1, portable on the right, LG on top. No gap.
  assert.deepEqual(plain(Fluxo.avisoDeVao(vivas(), [], "")), { avisar: false, assinatura: "" })
  // the portable came back off to the side: island
  const ilha = vivas({ "HDMI-A-4": null, "DP-1": { x: 3000, y: 0 } })
  assert.deepEqual(plain(Fluxo.avisoDeVao(ilha, [], "")), { avisar: true, assinatura: "DP-1" })
  assert.deepEqual(plain(Fluxo.avisoDeVao(ilha, [], "DP-1")), { avisar: false, assinatura: "DP-1" })
  // overlap: both ports, sorted
  const sobre = vivas({ "HDMI-A-4": null, "DP-1": { x: 100, y: 100 } })
  assert.deepEqual(plain(Fluxo.avisoDeVao(sobre, [], "DP-1")), { avisar: true, assinatura: "DP-1,eDP-1" })
  // overlap with no island (the portable also touches the LG): still sorted by code point
  const soSobre = vivas({ "DP-1": { x: 1900, y: 0 } })
  assert.deepEqual(plain(Fluxo.avisoDeVao(soSobre, [], "")), { avisar: true, assinatura: "DP-1,eDP-1" })
  // back to clean: signature resets, so the next gap warns again
  assert.deepEqual(plain(Fluxo.avisoDeVao(vivas(SEM_LG), [], "DP-1")), { avisar: false, assinatura: "" })
  // a screen over a ghost is not a gap; screens switched off or copying another do not count
  const fantasma = [{ chave: "desc:" + LG, x: 2048, y: 0, logW: 1920, logH: 1080 }]
  assert.deepEqual(plain(Fluxo.avisoDeVao(vivas(SEM_LG), fantasma, "")), { avisar: false, assinatura: "" })
  assert.deepEqual(plain(Fluxo.avisoDeVao(vivas({ "HDMI-A-4": null, "DP-1": { x: 3000, y: 0 } }, { "DP-1": { ligada: false } }), [], "")),
                   { avisar: false, assinatura: "" })
})

test("toda chave de notificação do Fluxo existe no catálogo", () => {
  const catalogo = JSON.parse(readFileSync(new URL("../i18n/pt-BR.json", import.meta.url), "utf8"))
  const fonte = readFileSync(new URL("../Fluxo.js", import.meta.url), "utf8")
  const chaves = [...fonte.matchAll(/"(notif\.[A-Za-z]+)"/g)].map((m) => m[1])
  assert.ok(chaves.length >= 1)
  for (const chave of chaves) assert.ok(Object.hasOwn(catalogo, chave), chave)
})

// ---- Tarefa 8, rulings do coordenador: revertendo e memória do aplicarSalvo ----

test("reconciliar não age em revertendo", () => {
  const nova = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } })
  const errada = vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4" } })
  // the state name, the substeps of the Aplicar and revert tables, and the Estado object
  for (const estado of ["revertendo", "armando", "avaliando", "lendo", "recarregando"]) {
    assert.deepEqual(reconciliar(nova, [PORTATIL_DP1], { estado }), [], estado)
    assert.deepEqual(reconciliar(errada, [PORTATIL_DP1], { estado }), [], estado)
  }
  const objeto = Object.assign(Fluxo.estadoInicial(), { nome: "revertendo", etapa: "lendo" })
  assert.deepEqual(plain(Fluxo.reconciliar(nova, [PORTATIL_DP1], REGRAS, {}, true, objeto, {})), [])
  // gravando and the open panel still reconcile
  for (const estado of ["gravando", "editando"]) assert.equal(reconciliar(nova, [PORTATIL_DP1], { estado }).length, 1, estado)
})

test("reconciliar é idempotente com aplicarSalvo", () => {
  // the LG saved on HDMI-A-4 at @75, now on DP-1 (a port or dock that only gives 60)
  const salvoLg = [linha(LG, "HDMI-A-4", "2560x1080@75", -256, -1080)]
  const lg60 = vivas({ "DP-1": null, "HDMI-A-4": { name: "DP-1", x: 2048, y: 0, refreshRate: 60,
                                                   availableModes: ["2560x1080@60.00Hz", "1920x1080@60.00Hz"] } })
  const primeira = reconciliar(lg60, salvoLg)
  assert.deepEqual(primeira.map((a) => a.tipo + " " + a.porta + " " + a.desc), ["aplicarSalvo DP-1 " + LG])
  // the root records porta -> desc; @75 maps to 60 here (Ruling 14), but Hyprland put the screen
  // somewhere else than saved, so it still differs: no repeat
  const aplicadas = { [primeira[0].porta]: primeira[0].desc }
  const depois = vivas({ "DP-1": null, "HDMI-A-4": { name: "DP-1", x: -256, y: -1000, refreshRate: 60,
                                                     availableModes: ["2560x1080@60.00Hz", "1920x1080@60.00Hz"] } })
  assert.equal(reconciliar(depois, salvoLg).length, 1)
  assert.deepEqual(reconciliar(depois, salvoLg, { aplicadas }), [])
  assert.deepEqual(reconciliar(lg60, salvoLg, { aplicadas }), [])
  // configreloaded or the screen leaving cleared the memory: one more application
  assert.deepEqual(reconciliar(lg60, salvoLg, { aplicadas: {} }).map((a) => a.tipo), ["aplicarSalvo"])
  // another known screen on the same port is not the applied one
  const portatil = vivas({ "HDMI-A-4": null, "DP-1": { x: -256, y: -1080 } })
  const lgNaHdmi = [linha(RTK, "HDMI-A-4", "1920x1080@60.00", 2048, 36)]
  assert.deepEqual(reconciliar(portatil, lgNaHdmi, { aplicadas }).map((a) => a.desc), [RTK])
  // the two memories do not mix: neutralizadas does not stop an aplicarSalvo, aplicadas does not stop a neutralizar
  assert.equal(reconciliar(lg60, salvoLg, { neutralizadas: aplicadas }).length, 1)
  const nova = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } })
  assert.equal(reconciliar(nova, [PORTATIL_DP1], { aplicadas: { "DP-1": NOVA } }).length, 1)
  // a key inherited from a prototype does not count
  assert.equal(reconciliar(lg60, salvoLg, { aplicadas: Object.create({ "DP-1": LG }) }).length, 1)
})

// ---- Onda de correções da revisão final (I1, I2, I3, Minor 5) ----

const ALVO2 = [ALVO[0], { porta: "HDMI-A-4", desc: LG, modo: "2560x1080@74.99", x: -100, y: -1080, transform: 0 }]
const ANTES2 = [ANTES[0], { porta: "HDMI-A-4", desc: LG, modo: "2560x1080@74.99", x: -256, y: -1080, transform: 0 }]
const IDA2 = Dados.montarEval(ALVO2, REGRAS).trecho
const VOLTA2 = Dados.montarEval(ANTES2, REGRAS).trecho
const lg = (x, y, extra) => tela("HDMI-A-4", x, y, 120, Object.assign({ desc: LG, modo: "2560x1080@74.99", w: 2560, h: 1080, hz: 74.99 }, extra || {}))
const confirmando2 = () => ultimo(rodar(editando(), [
  aplicar({ ida: IDA2, volta: VOLTA2, alvo: ALVO2, antes: ANTES2, regras: REGRAS,
            escalasAntes: { "DP-1": 120, "HDMI-A-4": 120, "eDP-1": 150 } }),
  { tipo: "guarda", ok: true }, { tipo: "evalRespondeu", saida: "ok" },
  { tipo: "leitura", telas: [EDP1, tela("DP-1", 2560, 0, 120), lg(-100, -1080)] },
])).estado

test("alvo com uma porta fora restaura todas e confere só as presentes", () => {
  assert.equal(confirmando2().nome, "confirmando")
  assert.match(VOLTA2, /"DP-1"/)
  const passos = rodar(confirmando2(), [
    { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" }, { tipo: "semVolta", porta: "DP-1" },
  ])
  const r = ultimo(passos)
  assert.equal(nomeEtapa(r), "revertendo/avaliando")
  // the whole volta, the port that left included (N1); the notice comes at the end
  assert.deepEqual(plain(r.efeitos), [{ tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }, { tipo: "eval", trecho: VOLTA2 }])
  const lido = Fluxo.transicao(r.estado, { tipo: "evalRespondeu", saida: "ok" })
  assert.deepEqual(plain(lido.efeitos), [{ tipo: "lerDeVolta", esperado: [ANTES2[1]] }])
  // DP-1 absent from the read does not hold the revert
  const fim = Fluxo.transicao(lido.estado, { tipo: "leitura", telas: [EDP1, lg(-256, -1080)] })
  assert.equal(fim.estado.nome, "editando")
  assert.deepEqual(plain(fim.efeitos), [
    { tipo: "desarmarGuarda", id: ID }, { tipo: "avisar", chave: "aviso.revertidoSemTela", args: ["DP-1"] },
  ])
  // a refused volta keeps the failure path that was there
  const falhou = Fluxo.transicao(r.estado, { tipo: "evalRespondeu", saida: "error: x" })
  assert.equal(falhou.estado.nome, "editando")
  assert.deepEqual(tipos(falhou), ["desarmarGuarda", "avisar"])
  // the read runs out with the present port away too: every port that did not match is away, no reload
  const semNenhuma = Fluxo.transicao(lido.estado, { tipo: "leituraEsgotada", detalhe: "", telas: [EDP1] })
  assert.equal(semNenhuma.estado.nome, "editando")
  assert.deepEqual(plain(semNenhuma.efeitos), [
    { tipo: "desarmarGuarda", id: ID }, { tipo: "avisar", chave: "aviso.revertidoSemTela", args: ["DP-1, HDMI-A-4"] },
  ])
})

test("porta presente que não bateu recarrega mesmo com outra fora", () => {
  // re-review N2, spec 8.6.3 item 2: HDMI-A-4 is there and on but never matched
  const passos = rodar(confirmando2(), [
    { tipo: "tela", nome: "monitorremovedv2", porta: "DP-1" }, { tipo: "semVolta", porta: "DP-1" },
    { tipo: "evalRespondeu", saida: "ok" }, { tipo: "leitura", telas: [EDP1, lg(0, 0)] },
    { tipo: "leituraEsgotada", detalhe: "", telas: [EDP1, lg(0, 0)] },
  ])
  const r = ultimo(passos)
  assert.equal(nomeEtapa(r), "revertendo/recarregando")
  assert.deepEqual(plain(r.efeitos), [{ tipo: "reload" }])
  const fim = Fluxo.transicao(r.estado, { tipo: "recarregou" })
  assert.equal(fim.estado.nome, "editando")
  assert.deepEqual(tipos(fim), ["desarmarGuarda", "avisar"])
  // the same with no port away at all
  const semFora = rodar(confirmando2(), [
    { tipo: "reverter" }, { tipo: "evalRespondeu", saida: "ok" },
    { tipo: "leituraEsgotada", detalhe: "", telas: [EDP1, tela("DP-1", 2048, 36, 120), lg(0, 0)] },
  ])
  assert.deepEqual(tipos(ultimo(semFora)), ["reload"])
})

test("revertendo com a porta do alvo fora da leitura termina sem reload", () => {
  const ateLer = () => ultimo(rodar(confirmando(), [{ tipo: "reverter" }, { tipo: "evalRespondeu", saida: "ok" }])).estado
  const casos = [[EDP1], [EDP1, tela("DP-1", 2048, 36, 120, { ligada: false })]]
  for (const telas of casos) {
    const r = Fluxo.transicao(ateLer(), { tipo: "leituraEsgotada", detalhe: "", telas })
    assert.equal(r.estado.nome, "editando")
    assert.deepEqual(plain(r.efeitos), [
      { tipo: "desarmarGuarda", id: ID }, { tipo: "avisar", chave: "aviso.revertidoSemTela", args: ["DP-1"] },
    ])
  }
  // the port is there and on, but the read never matched: the reload stays
  const outra = Fluxo.transicao(ateLer(), { tipo: "leituraEsgotada", detalhe: "", telas: TELAS_OUTRA })
  assert.deepEqual(tipos(outra), ["reload"])
})

test("concluirNeutralizacao não regrava o modo forçado quando a leitura ainda não mudou", () => {
  // I1: Hyprland applies the rule on the next frame. A read that still shows the forced mode
  // and transform asks for another read instead of writing that mode back.
  const esc = { "DP-1": 120, "eDP-1": 150 }
  const antes = { modo: "1920x1080@60.00", transform: 0 }
  const forcada = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } })
  assert.deepEqual(plain(Fluxo.concluirNeutralizacao(forcada, "DP-1", esc, REGRAS, antes, false)),
                   { falha: false, trecho: "", esperar: true })
  // the preferred mode arrived: the second step carries it, and the read it expects
  const preferido = vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA, width: 1280, height: 720, refreshRate: 60, x: 3000, y: 0 } })
  const r = plain(Fluxo.concluirNeutralizacao(preferido, "DP-1", esc, REGRAS, antes, false))
  assert.equal(r.falha, false)
  assert.equal(r.esperar, undefined)
  assert.match(r.trecho, /mode = "1280x720@60\.00"/)
  const pos = /position = "(-?\d+)x(-?\d+)"/.exec(r.trecho)
  assert.deepEqual(r.esperado, [{ porta: "DP-1", modo: "1280x720@60.00", x: Number(pos[1]), y: Number(pos[2]), transform: 0 }])
  // only the transform moved: applied too
  assert.equal(Fluxo.concluirNeutralizacao(forcada, "DP-1", esc, REGRAS, { modo: "1920x1080@60.00", transform: 1 }, false).esperar, undefined)
  // a changed scale is a failure even before the mode moves (D17)
  const escalaNova = forcada.map((t) => (t.porta === "DP-1" ? Object.assign({}, t, { escala120: 150 }) : t))
  assert.deepEqual(plain(Fluxo.concluirNeutralizacao(escalaNova, "DP-1", esc, REGRAS, antes, false)), { falha: true, trecho: "" })
  // the read-back window ran out: the mode is taken as the preferred one
  const fim = plain(Fluxo.concluirNeutralizacao(forcada, "DP-1", esc, REGRAS, antes, true))
  assert.equal(fim.esperar, undefined)
  assert.match(fim.trecho, /mode = "1920x1080@60\.00"/)
  // the screen left or was switched off meanwhile: done, nothing to wait for
  const saiu = vivas({ "HDMI-A-4": null, "DP-1": null })
  assert.deepEqual(plain(Fluxo.concluirNeutralizacao(saiu, "DP-1", { "DP-1": 120 }, REGRAS, antes, false)), { falha: false, trecho: "" })
})

test("as ações do reconciliador levam a leitura esperada e a volta", () => {
  const d = reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { description: NOVA } }), [PORTATIL_DP1])[0]
  assert.deepEqual(d.antes, { modo: "1920x1080@60.00", transform: 0 })
  assert.deepEqual(d.esperadoVolta, [{ porta: "DP-1", modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0 }])
  const c = reconciliar(vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4", x: -256, y: -1080 } }), [PORTATIL_DP1])[0]
  assert.equal(c.tipo, "aplicarSalvo")
  assert.deepEqual(c.esperado, [{ porta: "HDMI-A-4", modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0 }])
  // the way back: the live values, on the port only
  assert.equal(c.volta, 'hl.monitor({ output = "HDMI-A-4", mode = "1920x1080@60.00", position = "-256x-1080", transform = 0 })')
  assert.deepEqual(c.esperadoVolta, [{ porta: "HDMI-A-4", modo: "1920x1080@60.00", x: -256, y: -1080, transform: 0 }])
  assert.doesNotMatch(c.volta, PROIBIDO)
})

test("aplicarSalvo com escala mudada pede a volta (D17)", () => {
  const naHdmi = (extra) => vivas({ "HDMI-A-4": null, "DP-1": { name: "HDMI-A-4", x: 2048, y: 36 } }, { "HDMI-A-4": extra || {} })
  const esc = { "HDMI-A-4": 120, "eDP-1": 150 }
  assert.deepEqual(plain(Fluxo.concluirAplicarSalvo(naHdmi(), "HDMI-A-4", esc)), { falha: false })
  assert.deepEqual(plain(Fluxo.concluirAplicarSalvo(naHdmi({ escala120: 150 }), "HDMI-A-4", esc)), { falha: true })
  // the scale of another screen moving is a failure too (I17), and so is no scale on record
  const outra = naHdmi().map((t) => (t.porta === "eDP-1" ? Object.assign({}, t, { escala120: 192 }) : t))
  assert.equal(Fluxo.concluirAplicarSalvo(outra, "HDMI-A-4", esc).falha, true)
  assert.equal(Fluxo.concluirAplicarSalvo(naHdmi(), "HDMI-A-4", {}).falha, true)
  assert.equal(Fluxo.concluirAplicarSalvo(naHdmi(), "HDMI-A-4", null).falha, true)
})

test("Manter com arquivo inválido não grava por cima", () => {
  // I3: an invalid file on disk is never the base of a merge, so its absent screens are never lost
  const v = vivas(SEM_LG)
  const invalido = { existe: true, texto: "# outra coisa\n" }
  const r = plain(Fluxo.planejarGravacao("manter", "", invalido, v, REGRAS, "2026-11-21"))
  assert.deepEqual(r, { ok: false, motivo: "arquivoInvalido" })
  assert.equal(Fluxo.planejarGravacao("esquecer", "desc:" + LG, invalido, v, REGRAS, "2026-11-21").ok, false)
  // a valid file is merged, and its absent screen (the LG) stays
  const valido = { existe: true, texto: fixture("tsv/valido-2telas.tsv") }
  const m = plain(Fluxo.planejarGravacao("manter", "", valido, v, REGRAS, "2026-11-21"))
  assert.equal(m.ok, true)
  assert.deepEqual(m.entradas.map((e) => e.desc).sort(), [LG, RTK].sort())
  // no file: the live screens only
  const novo = plain(Fluxo.planejarGravacao("manter", "", { existe: false, texto: "" }, v, REGRAS, "2026-11-21"))
  assert.deepEqual(novo.entradas.map((e) => e.desc), [RTK])
  // forgetting from a valid file
  const e = plain(Fluxo.planejarGravacao("esquecer", "desc:" + LG, valido, v, REGRAS, "2026-11-21"))
  assert.deepEqual(e.entradas.map((x) => x.desc), [RTK])
  // the model turns the refusal into its own notice
  const gravando = Fluxo.transicao(confirmando(), { tipo: "manter" }).estado
  const g = Fluxo.transicao(gravando, { tipo: "gravou", ok: false, motivo: "arquivoInvalido" })
  assert.equal(g.estado.nome, "editando")
  assert.deepEqual(plain(g.efeitos), [{ tipo: "avisar", chave: "aviso.naoSalvouArquivoInvalido", args: [] }])
  assert.deepEqual(plain(Fluxo.transicao(gravando, { tipo: "gravou", ok: false }).efeitos),
                   [{ tipo: "avisar", chave: "aviso.naoSalvou", args: [] }])
})

test("reconciliador aborta a sequência quando o fluxo sai do estado ocioso", () => {
  // I14: checked before every eval of a reconciler sequence, with the root's live Estado
  for (const estado of [aplicando(), avaliando(), lendo(), confirmando(),
                        Fluxo.transicao(confirmando(), { tipo: "reverter" }).estado]) {
    assert.equal(Fluxo.reconciliadorPodeAgir(estado), false, estado.nome + "/" + estado.etapa)
  }
  for (const nome of ["aplicando", "confirmando", "revertendo", "armando", "avaliando", "lendo", "recarregando"]) {
    assert.equal(Fluxo.reconciliadorPodeAgir(nome), false, nome)
  }
  // the states where reconciliar acts: the same answer as reconciliar itself
  const gravando = Fluxo.transicao(confirmando(), { tipo: "manter" }).estado
  for (const estado of [Fluxo.estadoInicial(), editando(), gravando, "fechado", "somenteLeitura", "editando"]) {
    assert.equal(Fluxo.reconciliadorPodeAgir(estado), true, JSON.stringify(estado.nome || estado))
  }
  // anything unreadable is not idle
  for (const ruim of [null, undefined, 3, {}]) assert.equal(Fluxo.reconciliadorPodeAgir(ruim), false)
})
