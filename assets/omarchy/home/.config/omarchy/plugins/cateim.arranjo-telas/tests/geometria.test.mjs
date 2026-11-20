// Run from the plugin directory: node --test tests/*.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { carregar, plain, fixture } from "./carregar-modelo.mjs"
const Geo = carregar("Geometria.js")
const regras = { "eDP-1": {}, "HDMI-A-4": {}, "DP-1": {} }

// Hand-built screen: on, movable external by default.
function tela(porta, x, y, logW, logH, extra) {
  return Object.assign({ porta, x, y, logW, logH, ligada: true, espelho: false, interna: false, temRegra: true, movel: true }, extra || {})
}
const edp = () => tela("eDP-1", 0, 0, 2048, 1152, { interna: true, movel: false })
const monitores = () => JSON.parse(fixture("monitores-3telas.json"))

test("constantes do 8.5", () => {
  assert.deepEqual([Geo.MIN_CONTATO, Geo.LIMIAR_ENCAIXE, Geo.MAX_TELAS], [64, 16, 8])
})
test("ehInterna: eDP, LVDS e DSI são internas", () => {
  assert.deepEqual(["eDP-1", "LVDS-1", "DSI-1", "DP-1", "HDMI-A-4", "xeDP-1"].map(p => Geo.ehInterna(p)), [true, true, true, false, false, false])
})
test("tamanhoLogico: 2560x1440 a 1,25 dá 2048x1152 e a 1,6 dá 1600x900", () => {
  assert.deepEqual(plain(Geo.tamanhoLogico(2560, 1440, 1.25, 0)), { escala120: 150, logW: 2048, logH: 1152, fracionaria: false })
  assert.deepEqual(plain(Geo.tamanhoLogico(2560, 1440, 1.6, 0)), { escala120: 192, logW: 1600, logH: 900, fracionaria: false })
})
test("tamanhoLogico: transforms 1, 3, 5 e 7 trocam largura e altura", () => {
  for (const t of [1, 3, 5, 7]) assert.deepEqual([Geo.tamanhoLogico(1920, 1080, 1, t).logW, Geo.tamanhoLogico(1920, 1080, 1, t).logH], [1080, 1920])
  for (const t of [0, 2, 4, 6]) assert.deepEqual([Geo.tamanhoLogico(1920, 1080, 1, t).logW, Geo.tamanhoLogico(1920, 1080, 1, t).logH], [1920, 1080])
})
test("tamanhoLogico: escala em float dá o mesmo que 1,6", () => {
  assert.deepEqual(plain(Geo.tamanhoLogico(2560, 1440, 1.600000023841858, 0)), plain(Geo.tamanhoLogico(2560, 1440, 1.6, 0)))
})
test("tamanhoLogico: resultado fracionário é marcado e arredondado", () => {
  assert.deepEqual(plain(Geo.tamanhoLogico(1366, 768, 1.25, 0)), { escala120: 150, logW: 1093, logH: 614, fracionaria: true })
})
test("modosCompativeis: lê, tira repetidos e ordena por área e taxa", () => {
  const dp1 = JSON.parse(fixture("monitores-3telas.json")).find(m => m.name === "DP-1")
  const modos = Geo.modosCompativeis(dp1.availableModes, 1)
  assert.equal(modos.length, 12)
  assert.deepEqual([modos[0].modo, modos[1].modo], ["1920x1080@60.00", "1920x1080@59.94"])
  assert.deepEqual(plain(Geo.modosCompativeis(["2560x1080@74.99Hz"], 1)[0]), { modo: "2560x1080@74.99", w: 2560, h: 1080, hz: 74.99, compativel: true })
})
test("modosCompativeis: a 1,25, 1366x768 sai incompatível e 1920x1080 compatível", () => {
  const m = Geo.modosCompativeis(["1366x768@60.00Hz", "1920x1080@60.00Hz"], 1.25)
  assert.equal(m.find(x => x.w === 1366).compativel, false)
  assert.equal(m.find(x => x.w === 1920).compativel, true)
})
test("modosCompativeis: entrada fora do formato é ignorada", () => {
  assert.deepEqual(plain(Geo.modosCompativeis(["lixo", "1920x1080", null, "800x600@60.32Hz"], 1)).map(m => m.modo), ["800x600@60.32"])
  assert.deepEqual(plain(Geo.modosCompativeis(null, 1)), [])
})
test("lerMonitores: as três telas da fixture", () => {
  const r = Geo.lerMonitores(fixture("monitores-3telas.json"), regras)
  assert.equal(r.ok, true)
  assert.equal(r.motivo, "")
  assert.deepEqual(plain(r.telas).map(t => t.porta).sort(), ["DP-1", "HDMI-A-4", "eDP-1"])
  const edp = r.telas.find(t => t.porta === "eDP-1")
  assert.deepEqual([edp.interna, edp.movel, edp.logW, edp.logH, edp.modo], [true, false, 2048, 1152, "2560x1440@120.05"])
  assert.equal(r.telas.find(t => t.porta === "DP-1").movel, true)
  const lg = r.telas.find(t => t.porta === "HDMI-A-4")
  assert.deepEqual(plain(lg), {
    porta: "HDMI-A-4", desc: "LG Electronics LG ULTRAWIDE 0x0003B53D", w: 2560, h: 1080, hz: 74.99,
    modo: "2560x1080@74.99", x: -256, y: -1080, transform: 0, escala: 1, escala120: 120, logW: 2560,
    logH: 1080, fracionaria: false, ligada: true, espelho: false, interna: false, invertida: false,
    temRegra: true, movel: true, modos: ["2560x1080@74.99Hz", "2560x1080@60.00Hz", "1920x1080@60.00Hz"],
  })
  assert.deepEqual(plain(r.fora), [])
})
test("lerMonitores: desligada e espelhada vão para fora; transform 5 é invertida", () => {
  const m = monitores()
  m.find(x => x.name === "DP-1").disabled = true
  m.find(x => x.name === "HDMI-A-4").mirrorOf = "eDP-1"
  const r = Geo.lerMonitores(JSON.stringify(m), regras)
  assert.equal(r.ok, true)
  assert.deepEqual(plain(r.telas).map(t => t.porta), ["eDP-1"])
  assert.deepEqual(plain(r.fora).map(t => [t.porta, t.ligada, t.espelho]).sort(), [["DP-1", false, false], ["HDMI-A-4", true, true]])

  const g = monitores()
  g.find(x => x.name === "DP-1").transform = 5
  const dp = Geo.lerMonitores(JSON.stringify(g), regras).telas.find(t => t.porta === "DP-1")
  assert.deepEqual([dp.invertida, dp.movel, dp.logW, dp.logH], [true, false, 1080, 1920])
})
test("lerMonitores: porta sem regra não é móvel", () => {
  const r = Geo.lerMonitores(fixture("monitores-3telas.json"), { "eDP-1": {} })
  const dp = r.telas.find(t => t.porta === "DP-1")
  assert.deepEqual([dp.temRegra, dp.movel], [false, false])
  assert.equal(Geo.lerMonitores(fixture("monitores-3telas.json"), null).ok, true)
})
test("lerMonitores: 9 ligadas é recusado com maxTelas", () => {
  const dp1 = monitores().find(m => m.name === "DP-1")
  const copias = n => Array.from({ length: n }, (_, i) => Object.assign({}, dp1, { name: "DP-" + (i + 1) }))
  const nove = Geo.lerMonitores(JSON.stringify(copias(9)), regras)
  assert.deepEqual([nove.ok, nove.motivo, nove.telas.length, nove.fora.length], [false, "maxTelas", 0, 0])
  assert.equal(Geo.lerMonitores(JSON.stringify(copias(8)), regras).ok, true)
  const desligada = copias(9)
  desligada[8].disabled = true
  assert.equal(Geo.lerMonitores(JSON.stringify(desligada), regras).ok, true)
})
test("lerMonitores: JSON inválido ou que não é lista é recusado com json", () => {
  for (const ruim of ["{", "", "{}", "null", "42"]) {
    const r = Geo.lerMonitores(ruim, regras)
    assert.deepEqual([r.ok, r.motivo, r.telas.length, r.fora.length], [false, "json", 0, 0])
  }
})
test("normalizar: eDP-1 fora de 0x0 desloca todas e avisa", () => {
  // eDP-1 em (10, 5) e DP-1 em (2058, 41): saem (0, 0) e (2048, 36), deslocado true
  const r = Geo.normalizar([tela("eDP-1", 10, 5, 2048, 1152, { interna: true }), tela("DP-1", 2058, 41, 1920, 1080)])
  assert.equal(r.deslocado, true)
  assert.deepEqual(plain(r.telas).map(t => [t.porta, t.x, t.y]), [["eDP-1", 0, 0], ["DP-1", 2048, 36]])
  const certo = Geo.normalizar([edp(), tela("DP-1", 2048, 36, 1920, 1080)])
  assert.equal(certo.deslocado, false)
  assert.deepEqual(plain(certo.telas).map(t => [t.x, t.y]), [[0, 0], [2048, 36]])
})
test("normalizar: não muda as telas recebidas", () => {
  const telas = [tela("eDP-1", 10, 5, 2048, 1152, { interna: true })]
  Geo.normalizar(telas)
  assert.deepEqual([telas[0].x, telas[0].y], [10, 5])
})
test("retangulo: usa o tamanho lógico", () => {
  assert.deepEqual(plain(Geo.retangulo(tela("DP-1", 2048, 36, 1920, 1080, { w: 3840, h: 2160 }))), { x: 2048, y: 36, w: 1920, h: 1080 })
})
test("contato: quina não conta, lado com lado conta o trecho comum", () => {
  const a = { logW: 100, logH: 100, x: 0, y: 0 }
  assert.equal(Geo.contato(a, { logW: 100, logH: 100, x: 100, y: 100 }), 0)
  assert.equal(Geo.contato(a, { logW: 100, logH: 100, x: 100, y: 50 }), 50)
  assert.equal(Geo.contato(a, { logW: 30, logH: 100, x: 20, y: -100 }), 30)
  assert.equal(Geo.contato(a, { logW: 100, logH: 100, x: 101, y: 0 }), 0)
})
test("sobrepoe: só com área positiva", () => {
  const a = { logW: 100, logH: 100, x: 0, y: 0 }
  assert.equal(Geo.sobrepoe(a, { logW: 100, logH: 100, x: 99, y: 99 }), true)
  assert.equal(Geo.sobrepoe(a, { logW: 100, logH: 100, x: 100, y: 0 }), false)
  assert.equal(Geo.sobrepoe(a, { logW: 100, logH: 100, x: 100, y: 100 }), false)
})
test("validar: arranjo ao vivo não acusa nada", () => {
  const v = Geo.validar([edp(), tela("DP-1", 2048, 36, 1920, 1080), tela("HDMI-A-4", -256, -1080, 2560, 1080)], [])
  assert.deepEqual(plain(v), { sobreposicoes: [], ilhas: [], estreitos: [], sobreFantasma: [], bloqueia: false })
})
test("validar: sobreposição de área positiva entre ligadas bloqueia", () => {
  const v = Geo.validar([edp(), tela("DP-1", 2000, 0, 1920, 1080)], [])
  assert.deepEqual(plain(v.sobreposicoes), [["eDP-1", "DP-1"]])
  assert.equal(v.bloqueia, true)
  const desligada = Geo.validar([edp(), tela("DP-1", 2048, 0, 1920, 1080), tela("DP-2", 100, 100, 800, 600, { ligada: false })], [])
  assert.deepEqual([desligada.sobreposicoes.length, desligada.bloqueia], [0, false])
})
test("validar: tela ligada sobre fantasma só avisa", () => {
  const fantasma = { chave: "LG Electronics LG ULTRAWIDE 0x0003B53D", x: 2100, y: 0, logW: 2560, logH: 1080 }
  const v = Geo.validar([edp(), tela("DP-1", 2048, 36, 1920, 1080)], [fantasma])
  assert.deepEqual(plain(v.sobreFantasma), [["DP-1", "LG Electronics LG ULTRAWIDE 0x0003B53D"]])
  assert.deepEqual([v.sobreposicoes.length, v.ilhas.length, v.bloqueia], [0, 0, false])
})
test("validar: quatro telas em dois pares encostados dão duas ilhas", () => {
  const v = Geo.validar([edp(), tela("DP-1", 2048, 0, 1920, 1080), tela("DP-2", 10000, 0, 1920, 1080), tela("DP-3", 11920, 0, 1920, 1080)], [])
  assert.deepEqual(plain(v.ilhas), ["DP-2", "DP-3"])
  assert.deepEqual([v.sobreposicoes.length, v.bloqueia], [0, true])
})
test("validar: contato estreito com uma vizinha e largo com outra só avisa", () => {
  // DP-1 encosta no eDP-1 com 1080; DP-2 encosta embaixo do eDP-1 com 1888 e do DP-1 com 32.
  const v = Geo.validar([edp(), tela("DP-1", 2048, 72, 1920, 1080), tela("DP-2", 160, 1152, 1920, 1080)], [])
  assert.deepEqual(plain(v.estreitos), [["DP-1", "DP-2"]])
  assert.deepEqual([v.ilhas.length, v.sobreposicoes.length, v.bloqueia], [0, 0, false])
})
test("validar: contato só estreito com o resto vira ilha", () => {
  const v = Geo.validar([edp(), tela("DP-1", 2048, 1152 - 32, 1920, 1080)], [])
  assert.deepEqual(plain(v.estreitos), [["eDP-1", "DP-1"]])
  assert.deepEqual([plain(v.ilhas), v.bloqueia], [["DP-1"], true])
})
test("validar: tela sem regra solta não vira ilha, mas sobrepor nela bloqueia", () => {
  const solta = tela("DP-3", 20000, 0, 1920, 1080, { temRegra: false, movel: false })
  const v = Geo.validar([edp(), tela("DP-1", 2048, 0, 1920, 1080), solta], [])
  assert.deepEqual([plain(v.ilhas), v.bloqueia], [[], false])
  const invertida = tela("DP-4", -5000, 0, 1080, 1920, { invertida: true, movel: false })
  assert.deepEqual(plain(Geo.validar([edp(), invertida], []).ilhas), [])

  // DP-2 encosta no DP-1 (sem ilha) e invade a DP-3 sem regra: só a sobreposição bloqueia.
  const perto = tela("DP-3", 4000, 0, 1920, 1080, { temRegra: false, movel: false })
  const v2 = Geo.validar([edp(), tela("DP-1", 2048, 0, 1920, 1080), perto, tela("DP-2", 3968, 0, 1920, 1080)], [])
  assert.deepEqual(plain(v2.sobreposicoes), [["DP-3", "DP-2"]])
  assert.deepEqual([plain(v2.ilhas), v2.bloqueia], [[], true])
})
test("validar: sem tela interna ligada não há referência e nada vira ilha", () => {
  const v = Geo.validar([tela("DP-1", 0, 0, 1920, 1080), tela("DP-2", 9000, 0, 1920, 1080)], [])
  assert.deepEqual([plain(v.ilhas), v.bloqueia], [[], false])
})

// ---- Tarefa 3: encaixe e correção ----

const dp = (porta, x, y, w, h) => tela(porta, x, y, w, h, { w, h, hz: 60, modo: w + "x" + h + "@60.00", transform: 0, escala: 1, escala120: 120 })
const pos = (telas, porta) => { const t = plain(telas).find(x => x.porta === porta); return [t.x, t.y] }
const semErro = telas => {
  const v = plain(Geo.validar(telas, []))
  assert.deepEqual([v.sobreposicoes, v.ilhas], [[], []])
}

test("encaixar: dentro do limiar encaixa na borda, fora não", () => {
  // eDP-1 0x0 2048x1152; DP-1 1920x1080 solto em x 2040 -> 2048; em x 2020 fica 2020 (limiar 16)
  const d = dp("DP-1", 0, 0, 1920, 1080)
  assert.deepEqual(plain(Geo.encaixar(d, [edp()], { x: 2040, y: 36 }, 16)), { x: 2048, y: 36 })
  assert.deepEqual(plain(Geo.encaixar(d, [edp()], { x: 2020, y: 36 }, 16)), { x: 2020, y: 36 })
  // y também encaixa (topo com topo), e posição fracionária sai inteira
  assert.deepEqual(plain(Geo.encaixar(d, [edp()], { x: 2020.4, y: -9.6 }, 16)), { x: 2020, y: 0 })
  // a própria tela e uma tela desligada (como um fantasma) não atraem
  const desligada = tela("DP-2", 2030, 500, 1920, 1080, { ligada: false })
  assert.deepEqual(plain(Geo.encaixar(d, [dp("DP-1", 2030, 40, 1920, 1080), desligada], { x: 2020, y: 36 }, 16)), { x: 2020, y: 36 })
})
test("soltar: no vão vai ao candidato válido mais perto", () => {
  const r = Geo.soltar([edp(), dp("DP-1", 2048, 36, 1920, 1080)], "DP-1", { x: 2100, y: 36 })
  assert.deepEqual(pos(r, "DP-1"), [2048, 36])
  semErro(r)
})
test("soltar: em cima de outra ligada vai ao candidato válido mais perto", () => {
  // LG em cima da DP-1 e do eDP-1: o melhor candidato é embaixo da DP-1, x mantido
  const telas = [edp(), dp("DP-1", 2048, 36, 1920, 1080), dp("HDMI-A-4", -256, -1080, 2560, 1080)]
  const r = Geo.soltar(telas, "HDMI-A-4", { x: 2100, y: 100 })
  assert.deepEqual(pos(r, "HDMI-A-4"), [2100, 1116])
  assert.deepEqual(pos(r, "DP-1"), [2048, 36])
  semErro(r)
})
test("soltar: em cima de um fantasma fica onde caiu", () => {
  const fantasma = { chave: "LG Electronics LG ULTRAWIDE 0x0003B53D", x: 2048, y: 0, logW: 2560, logH: 1080 }
  const r = Geo.soltar([edp(), dp("DP-1", -1920, 0, 1920, 1080)], "DP-1", { x: 2048, y: 500 })
  assert.deepEqual(pos(r, "DP-1"), [2048, 500])
  const v = plain(Geo.validar(r, [fantasma]))
  assert.deepEqual([v.sobreposicoes, v.ilhas, v.sobreFantasma], [[], [], [["DP-1", fantasma.chave]]])
})
test("soltar: tela que já valia não se move", () => {
  const telas = [edp(), dp("DP-1", 2048, 36, 1920, 1080)]
  const antes = plain(telas)
  const r = Geo.soltar(telas, "DP-1", { x: -1920, y: 200 })
  assert.deepEqual(pos(r, "DP-1"), [-1920, 200])
  assert.deepEqual(plain(telas), antes)
  // o eDP-1 nunca se move
  assert.deepEqual(pos(Geo.soltar(telas, "eDP-1", { x: 500, y: 500 }), "eDP-1"), [0, 0])
})
test("soltar: tela que ficou solta pelo movimento é corrigida", () => {
  // eDP-1 <- DP-1 <- X (X só encosta na DP-1); soltar a DP-1 do outro lado deixa X ilha; corrigir a junta de novo
  const telas = [edp(), dp("DP-1", 2048, 0, 1920, 1080), dp("DP-2", 3968, 0, 1920, 1080)]
  const r = Geo.soltar(telas, "DP-1", { x: -1920, y: 0 })
  assert.deepEqual(pos(r, "DP-1"), [-1920, 0])
  assert.deepEqual(pos(r, "DP-2"), [2048, 0])
  semErro(r)
})
test("corrigir: eDP-1 a 1,6 leva a portátil de x 2048 para x 1600 e mantém y 36", () => {
  // eDP-1 1600x900 (escala 1,6) em 0x0; DP-1 1920x1080 em 2048,36 -> 1600,36
  const telas = [tela("eDP-1", 0, 0, 1600, 900, { interna: true, movel: false }), dp("DP-1", 2048, 36, 1920, 1080)]
  const r = Geo.corrigir(telas, [])
  assert.deepEqual(pos(r, "DP-1"), [1600, 36])
  assert.deepEqual(pos(r, "eDP-1"), [0, 0])
  assert.deepEqual(pos(telas, "DP-1"), [2048, 36])
})
test("corrigir: tela sem regra nunca se move e arranjo válido fica igual", () => {
  const telas = [edp(), dp("DP-1", 2048, 36, 1920, 1080), tela("DP-3", 2100, 0, 1920, 1080, { temRegra: false, movel: false })]
  const r = Geo.corrigir(telas, [])
  assert.deepEqual(pos(r, "DP-3"), [2100, 0])
  assert.deepEqual(plain(Geo.validar(r, [])).sobreposicoes, [])
  const valido = [edp(), dp("DP-1", 2048, 36, 1920, 1080), dp("HDMI-A-4", -256, -1080, 2560, 1080)]
  assert.deepEqual(plain(Geo.corrigir(valido, [])), plain(valido))
})
test("corrigir: fixa inicial que sobrepõe o eDP-1 perde a preferência", () => {
  // DP-1 alcançada pela DP-2 (que encosta no eDP-1 com 72) mas em cima do eDP-1
  const telas = [edp(), dp("DP-1", -1920, 0, 2560, 1080), dp("DP-2", -1920, 1080, 1920, 1080)]
  assert.deepEqual(plain(Geo.validar(telas, [])).sobreposicoes, [["eDP-1", "DP-1"]])
  const r = Geo.corrigir(telas, ["DP-1"])
  semErro(r)
  assert.deepEqual(pos(r, "DP-2"), [-1920, 1080])
})
test("redimensionar: trocar o modo do LG mantém o LG em cima", () => {
  // LG -256,-1080 2560x1080 -> 1920x1080@60: y continua -1080 (em cima), contato >= 64
  const telas = [edp(), dp("DP-1", 2048, 36, 1920, 1080), dp("HDMI-A-4", -256, -1080, 2560, 1080)]
  const r = Geo.redimensionar(telas, "HDMI-A-4", { w: 1920, h: 1080, hz: 60 }, 0)
  assert.equal(r.ok, true)
  const lg = plain(r.telas).find(t => t.porta === "HDMI-A-4")
  assert.deepEqual([lg.x, lg.y, lg.logW, lg.logH, lg.modo, lg.transform], [-256, -1080, 1920, 1080, "1920x1080@60.00", 0])
  assert.ok(Geo.contato(lg, edp()) >= Geo.MIN_CONTATO)
  semErro(r.telas)
  assert.equal(plain(telas)[2].logW, 2560)
})
test("redimensionar: girar a portátil 90° mantém o lado direito", () => {
  // DP-1 2048,36 vira 1080x1920; x continua 2048, contato com o eDP-1 >= 64
  const r = Geo.redimensionar([edp(), dp("DP-1", 2048, 36, 1920, 1080)], "DP-1", { w: 1920, h: 1080, hz: 60 }, 1)
  const d = plain(r.telas).find(t => t.porta === "DP-1")
  assert.deepEqual([d.x, d.y, d.logW, d.logH, d.transform], [2048, 36, 1080, 1920, 1])
  assert.ok(Geo.contato(d, edp()) >= Geo.MIN_CONTATO)
})
test("redimensionar: à esquerda e embaixo seguem a borda da vizinha", () => {
  const esq = Geo.redimensionar([edp(), dp("DP-1", -1920, 0, 1920, 1080)], "DP-1", { w: 2560, h: 1080, hz: 60 }, 0)
  assert.deepEqual(pos(esq.telas, "DP-1"), [-2560, 0])
  const baixo = Geo.redimensionar([edp(), dp("DP-1", 0, 1152, 1920, 1080)], "DP-1", { w: 1920, h: 1080, hz: 60 }, 1)
  assert.deepEqual(pos(baixo.telas, "DP-1"), [0, 1152])
})
test("redimensionar: eDP-1 é recusado", () => {
  const r = Geo.redimensionar([edp(), dp("DP-1", 2048, 36, 1920, 1080)], "eDP-1", { w: 1920, h: 1080, hz: 60 }, 0)
  assert.deepEqual([r.ok, r.motivo], [false, "interna"])
  assert.deepEqual(pos(r.telas, "eDP-1"), [0, 0])
})
test("redimensionar: porta desconhecida, tela fixa e transform 4 a 7 são recusados", () => {
  const telas = [edp(), dp("DP-1", 2048, 36, 1920, 1080), tela("DP-3", -1920, 0, 1920, 1080, { temRegra: false, movel: false })]
  const modo = { w: 1920, h: 1080, hz: 60 }
  assert.deepEqual([Geo.redimensionar(telas, "DP-9", modo, 0).motivo, Geo.redimensionar(telas, "DP-3", modo, 0).motivo,
                    Geo.redimensionar(telas, "DP-1", modo, 5).motivo], ["porta", "fixa", "transform"])
})
test("propostaParaNova: ao lado da ligada mais perto, ignorando a posição sobreposta", () => {
  // tela nova que o Hyprland pôs em cima do eDP-1 vai para o candidato válido mais perto
  const telas = [edp(), dp("DP-1", 2048, 36, 1920, 1080), dp("HDMI-A-4", 100, 100, 2560, 1080)]
  assert.deepEqual(plain(Geo.propostaParaNova(telas, "HDMI-A-4")), { x: 100, y: 1152 })
  assert.equal(Geo.propostaParaNova(telas, "DP-9"), null)
})
test("posicionarJunto: desempate pela fixa de menor índice e lado direita, abaixo, esquerda, acima", () => {
  // quadrado 100x100 entre dois quadrados iguais: direita do primeiro e esquerda do segundo empatam
  const a = tela("A", 0, 0, 100, 100), b = tela("B", 300, 0, 100, 100), t = tela("T", 0, 0, 100, 100)
  assert.deepEqual(plain(Geo.posicionarJunto([a, b], t, { x: 150, y: 0 })), { x: 100, y: 0 })
  assert.deepEqual(plain(Geo.posicionarJunto([b, a], t, { x: 150, y: 0 })), { x: 200, y: 0 })
  // perpendicular presa para dar contato >= MIN_CONTATO
  assert.deepEqual(plain(Geo.posicionarJunto([a], t, { x: 300, y: 50 })), { x: 100, y: 36 })
  assert.deepEqual(plain(Geo.posicionarJunto([], t, { x: 7.6, y: 3 })), { x: 8, y: 3 })
})

function mulberry32(semente) {
  let a = semente
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test("propriedades: 500 arranjos com semente fixa", () => {
  // PRNG mulberry32 com semente 20261120; n de 2 a 6 telas, eDP-1 sempre em 0x0 com 2048x1152;
  // externas de { 1920x1080, 2560x1080, 1280x1024, 1080x1920 }, posições em [-4000, 4000];
  // 0 a 2 fantasmas. Para cada arranjo, corrigir, depois soltar (tela e ponto aleatórios),
  // depois redimensionar (tela externa e modo aleatórios). Em cada resultado:
  // validar(...).sobreposicoes e .ilhas vazias; eDP-1 em 0,0; x e y inteiros;
  // rodar duas vezes a mesma entrada dá a mesma saída (deepEqual).
  const aleatorio = mulberry32(20261120)
  const inteiro = (min, max) => min + Math.floor(aleatorio() * (max - min + 1))
  const escolher = lista => lista[Math.floor(aleatorio() * lista.length)]
  const tamanhos = [[1920, 1080], [2560, 1080], [1280, 1024], [1080, 1920]]
  const confere = (telas, fantasmas, rotulo) => {
    const v = plain(Geo.validar(telas, fantasmas))
    assert.deepEqual([v.sobreposicoes, v.ilhas], [[], []], rotulo)
    assert.deepEqual(pos(telas, "eDP-1"), [0, 0], rotulo)
    for (const t of plain(telas)) assert.ok(Number.isInteger(t.x) && Number.isInteger(t.y), rotulo)
  }
  const rodar = (telas, solta, ponto, alvo, modo, transform) => {
    const corrigidas = Geo.corrigir(telas, [])
    const soltas = Geo.soltar(corrigidas, solta, ponto)
    const redim = Geo.redimensionar(soltas, alvo, modo, transform)
    return { corrigidas: plain(corrigidas), soltas: plain(soltas), redim: plain(redim) }
  }
  for (let caso = 0; caso < 500; caso++) {
    const n = inteiro(2, 6)
    const telas = [edp()]
    for (let i = 1; i < n; i++) {
      const [w, h] = escolher(tamanhos)
      telas.push(dp("DP-" + i, inteiro(-4000, 4000), inteiro(-4000, 4000), w, h))
    }
    const fantasmas = []
    for (let f = inteiro(0, 2); f > 0; f--) {
      const [w, h] = escolher(tamanhos)
      fantasmas.push({ chave: "Fantasma " + f, x: inteiro(-4000, 4000), y: inteiro(-4000, 4000), logW: w, logH: h })
    }
    const solta = escolher(telas).porta
    const ponto = { x: inteiro(-4000, 4000) + aleatorio(), y: inteiro(-4000, 4000) + aleatorio() }
    const alvo = escolher(telas.slice(1)).porta
    const [mw, mh] = escolher(tamanhos)
    const modo = { w: mw, h: mh, hz: 60 }
    const transform = inteiro(0, 3)

    const entrada = plain(telas)
    const r = rodar(telas, solta, ponto, alvo, modo, transform)
    const rotulo = "caso " + caso
    assert.deepEqual(plain(telas), entrada, rotulo)
    confere(r.corrigidas, fantasmas, rotulo + " corrigir")
    confere(r.soltas, fantasmas, rotulo + " soltar")
    assert.equal(r.redim.ok, true, rotulo)
    confere(r.redim.telas, fantasmas, rotulo + " redimensionar")
    assert.deepEqual(rodar(telas, solta, ponto, alvo, modo, transform), r, rotulo)
  }
})
