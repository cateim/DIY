// Run from the plugin directory: node --test tests/*.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { carregar, plain, fixture } from "./carregar-modelo.mjs"

const Dados = carregar("Dados.js")
const monitorsLua = fixture("monitors.lua")
const regras = Dados.regrasDoMonitorsLua(monitorsLua)

const RTK = "Invalid Vendor Codename - RTK FHD demoset-1"
const LG = "LG Electronics LG ULTRAWIDE 0x0003B53D"
const CAB = "# cateim.arranjo-telas v1\n# gerado pelo painel de arranjo das telas; não edite à mão\n"
const LINHA_RTK = RTK + "\tDP-1\t1920x1080@60.00\t2048\t36\t0\t2026-11-20\n"
const LINHA_LG = LG + "\tHDMI-A-4\t2560x1080@75\t-256\t-1080\t0\t2026-11-20\n"
const INJECAO = '"}) os.execute("x") --'
const PROIBIDOS = /scale|disabled|mirror/

// One "<file>\t<expected>" pair per line of tsv/esperado.txt.
function linhasDoEsperado() {
  return fixture("tsv/esperado.txt").split("\n").filter((l) => l !== "").map((l) => l.split("\t"))
}

const resultado = (r) => (r.ok ? "valido" : r.linha + ":" + r.motivo)
const lerTexto = (texto) => resultado(Dados.lerTsv(texto))
const alvo = (porta, desc, extra) => Object.assign({ porta, desc, modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0 }, extra || {})
const entradaRtk = () => ({ desc: RTK, porta: "DP-1", modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0, visto: "2026-11-20" })
const entradaLg = () => ({ desc: LG, porta: "HDMI-A-4", modo: "2560x1080@75", x: -256, y: -1080, transform: 0, visto: "2026-11-20" })

// Runs a generated chunk in a real Lua 5.5 with a fake `hl`, `os.execute`
// stubbed to fail, and prints, per hl.monitor call, the output and the
// sorted key list. Returns { status, saida: [{ output, chaves }] }.
function rodarNoLua(trecho) {
  const prologo = [
    "local saida = {}",
    'os.execute = function() error("executou") end',
    "hl = { monitor = function(t)",
    "  local chaves = {}",
    "  for k in pairs(t) do chaves[#chaves + 1] = k end",
    "  table.sort(chaves)",
    '  saida[#saida + 1] = t.output .. "\\0" .. table.concat(chaves, ",")',
    "end }",
  ].join("\n")
  const epilogo = '\nio.write(table.concat(saida, "\\n"))'
  const r = spawnSync("lua5.5", ["-e", prologo + "\n" + trecho + epilogo], { encoding: "utf8" })
  const saida = r.stdout === "" ? [] : r.stdout.split("\n").map((l) => {
    const [output, chaves] = l.split("\0")
    return { output, chaves }
  })
  return { status: r.status, stderr: r.stderr, saida }
}

// ---- constantes e validadores ----

test("constantes da Tarefa 4", () => {
  assert.equal(Dados.CABECALHO, "# cateim.arranjo-telas v1")
  assert.equal(Dados.COMENTARIO, "# gerado pelo painel de arranjo das telas; não edite à mão")
  assert.deepEqual(
    [Dados.MAX_LINHAS_TSV, Dados.CORTE_TSV, Dados.MAX_BYTES_TSV, Dados.MAX_BYTES_LINHA, Dados.MAX_DESC, Dados.MAX_POS, Dados.MAX_BYTES_MONITORS, Dados.MAX_LINHAS_MONITORS],
    [32, 24, 8192, 512, 128, 32768, 65536, 500])
  assert.deepEqual(plain(Dados.CODIGOS_MOTIVO), [
    "bytes", "utf8", "linhaLonga", "cabecalho", "fim", "contagem", "colunas", "desc", "porta",
    "portaInterna", "modo", "posicao", "transform", "visto", "portaRepetida", "descRepetida", "linhas",
  ])
})
test("bytesUtf8 e contarCaracteres contam UTF-8 e pontos de código", () => {
  assert.deepEqual([Dados.bytesUtf8(""), Dados.bytesUtf8("abc"), Dados.bytesUtf8("ç"), Dados.bytesUtf8("€"), Dados.bytesUtf8("😀")], [0, 3, 2, 3, 4])
  assert.deepEqual([Dados.contarCaracteres("abc"), Dados.contarCaracteres("ção"), Dados.contarCaracteres("a😀b")], [3, 3, 3])
  const misto = "Tela ç € 😀 teste"
  assert.equal(Dados.bytesUtf8(misto), Buffer.byteLength(misto))
})
test("validarDesc: 1 a 128 pontos de código, sem controle nem U+FFFD", () => {
  assert.ok(Dados.validarDesc(RTK))
  assert.ok(Dados.validarDesc("-"))
  assert.ok(Dados.validarDesc(INJECAO))
  assert.ok(Dados.validarDesc("é".repeat(128)))
  assert.ok(!Dados.validarDesc("é".repeat(129)))
  assert.ok(!Dados.validarDesc(""))
  for (const ruim of ["a\u0000b", "a\tb", "a\nb", "a\rb", "a\u001fb", "a\u007fb", "a�b"]) assert.ok(!Dados.validarDesc(ruim), JSON.stringify(ruim))
  assert.ok(!Dados.validarDesc(undefined))
  assert.ok(!Dados.validarDesc(12))
})
test("validarPorta e validarModo seguem as regex do 8.3", () => {
  for (const p of ["DP-1", "HDMI-A-4", "eDP-1", "a.b_c-d", "-", "x".repeat(32)]) assert.ok(Dados.validarPorta(p), p)
  for (const p of ["", 'DP-1"x', "DP 1", "x".repeat(33), "DP-1\n", undefined]) assert.ok(!Dados.validarPorta(p), String(p))
  for (const m of ["1920x1080@60.00", "2560x1080@75", "800x600@1.5", "10000x10000@999.999"]) assert.ok(Dados.validarModo(m), m)
  for (const m of ["1920x1080", "1920x1080@60.0000", "99x100@60", "1920x1080@1000", "1920x1080@60Hz", "preferred", undefined]) assert.ok(!Dados.validarModo(m), String(m))
})
test("parseModo", () => {
  assert.deepEqual(plain(Dados.parseModo("1920x1080@60.00")), { w: 1920, h: 1080, hz: 60 })
  assert.deepEqual(plain(Dados.parseModo("2560x1080@74.99")), { w: 2560, h: 1080, hz: 74.99 })
  assert.equal(Dados.parseModo("1920x1080"), null)
  assert.equal(Dados.parseModo("preferred"), null)
})

// ---- regras do monitors.lua ----

test("regrasDoMonitorsLua acha as 5 regras do monitors.lua atual", () => {
  const r = Dados.regrasDoMonitorsLua(monitorsLua)
  assert.deepEqual(plain(Object.keys(r)).sort(), ["DP-1", "HDMI-A-4", "desc:Invalid Vendor Codename - RTK FHD demoset-1",
    "desc:LG Electronics LG ULTRAWIDE 0x0003B53D", "eDP-1"])
  assert.deepEqual(plain(r["HDMI-A-4"]), { modo: "2560x1080@75", posicao: "-256x-1080", escala: 1, transform: 0 })
  assert.deepEqual(plain(r["eDP-1"]), { modo: "2560x1440@120", posicao: "0x0", escala: 1.25, transform: 0 })
  assert.deepEqual(plain(r["desc:" + RTK]), { modo: "1920x1080@60", posicao: "2048x36", escala: 1, transform: 0 })
  assert.equal(r[""], undefined)          // catch-all
  assert.equal(r["DP-2"], undefined)      // as linhas comentadas do fim do arquivo
})
test("regra no formato do persist_scale passa a contar", () => {
  const r = Dados.regrasDoMonitorsLua(monitorsLua + 'hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1.5 })\n')
  assert.deepEqual(plain(r["DP-2"]), { modo: "preferred", posicao: "auto", escala: 1.5, transform: 0 })
})
test("regra com comentário no fim, transform e scale que não é literal", () => {
  const r = Dados.regrasDoMonitorsLua([
    'hl.monitor({ output = "DP-3", mode = "1920x1080@60", position = "0x0", scale = 1, transform = 1 })   -- girada',
    'hl.monitor({ output = "DP-4", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })',
    'hl.monitor({ output = "DP-5", position = "auto", scale = "1.25" })',
    'hl.monitor({ output = "DP-6", mode = "preferred", transform = algo })',
  ].join("\n"))
  assert.deepEqual(plain(r["DP-3"]), { modo: "1920x1080@60", posicao: "0x0", escala: 1, transform: 1 })
  assert.deepEqual(plain(r["DP-4"]), { modo: "preferred", posicao: "auto", escala: null, transform: 0 })
  assert.deepEqual(plain(r["DP-5"]), { modo: null, posicao: "auto", escala: null, transform: 0 })
  assert.deepEqual(plain(r["DP-6"]), { modo: "preferred", posicao: null, escala: null, transform: 0 })
})
test("linhas fora do formato do persist_scale não contam", () => {
  const r = Dados.regrasDoMonitorsLua([
    '  hl.monitor({ output = "DP-2", mode = "preferred" })',                 // não começa na coluna 1
    '-- hl.monitor({ output = "DP-3", mode = "preferred" })',                // comentada
    'hl.monitor({ output = "DP-4", mode = "preferred",',                     // não termina em })
    '  scale = 1 })',
    'hl.monitor({output = "DP-5", mode = "preferred" })',                    // sem o espaço do formato
    'hl.monitor({ output = "", mode = "preferred" })',                       // catch-all
    'hl.monitor({ output = "DP-6", mode = "preferred" }) x = 1',             // código depois do })
    'local nome = "DP-7"; hl.monitor({ output = nome, mode = "preferred" })', // montada por código
  ].join("\n"))
  assert.deepEqual(plain(Object.keys(r)), [])
})
test("regrasDoMonitorsLua ignora regra em comentário de bloco", () => {
  const regraDp2 = 'hl.monitor({ output = "DP-2", mode = "1920x1080@60", position = "4000x0" })'
  const tem = (texto) => Dados.temRegra(Dados.regrasDoMonitorsLua(texto), "DP-2")
  assert.ok(tem(regraDp2 + "\n"), "sem comentário")
  assert.ok(!tem("--[[\n" + regraDp2 + "\n]]\n"), "--[[ ]]")
  assert.ok(!tem("--[==[\n]]\n" + regraDp2 + "\n]==]\n"), "--[==[ só fecha com ]==]")
  assert.ok(tem("--[==[\nx\n]==]\n" + regraDp2 + "\n"), "depois do ]==] conta")
  assert.ok(tem("--[[ x ]]\n" + regraDp2 + "\n"), "bloco aberto e fechado na mesma linha")
  assert.ok(tem("-- [[\n" + regraDp2 + "\n"), "-- [[ é comentário de linha")
  assert.ok(tem("---[[\n" + regraDp2 + "\n"), "---[[ é comentário de linha")
  assert.ok(!tem("local x = 1 --[[ abre\n" + regraDp2 + "\n]]\n"), "aberto no fim de uma linha de código")
  assert.ok(!tem("--[[ a ]] --[[ b\n" + regraDp2 + "\n]]\n"), "segundo bloco na mesma linha fica aberto")
  // a rule line that opens a block keeps its own rule, and the block hides the next ones
  const regraDp3 = 'hl.monitor({ output = "DP-3", mode = "preferred" })'
  const r = Dados.regrasDoMonitorsLua(regraDp2 + " --[[ comentário\n" + regraDp3 + "\n]]\n")
  assert.equal(Dados.temRegra(r, "DP-2"), true)
  assert.equal(Dados.temRegra(r, "DP-3"), false)
})
test("nome repetido: vale a última linha", () => {
  const r = Dados.regrasDoMonitorsLua([
    'hl.monitor({ output = "DP-2", mode = "1920x1080@60", position = "0x0", scale = 1 })',
    'hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "10x20", scale = 2 })',
  ].join("\n"))
  assert.deepEqual(plain(r["DP-2"]), { modo: "2560x1440@144", posicao: "10x20", escala: 2, transform: 0 })
})
test("nomes como __proto__ e constructor viram regra comum, sem herança", () => {
  const vazio = Dados.regrasDoMonitorsLua("")
  assert.equal(Dados.temRegra(vazio, "constructor"), false)
  assert.equal(Dados.temRegra(vazio, "__proto__"), false)
  const r = Dados.regrasDoMonitorsLua('hl.monitor({ output = "__proto__", mode = "preferred" })\n')
  assert.equal(Dados.temRegra(r, "__proto__"), true)
  assert.deepEqual(plain(Object.keys(r)), ["__proto__"])
})
test("regra depois da linha 500 ou dos 64 KiB não conta", () => {
  const regraDp2 = 'hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1 })'
  // rule on line 500 counts, on line 501 does not
  assert.ok(Dados.temRegra(Dados.regrasDoMonitorsLua("-- x\n".repeat(499) + regraDp2 + "\n"), "DP-2"))
  assert.ok(!Dados.temRegra(Dados.regrasDoMonitorsLua("-- x\n".repeat(500) + regraDp2 + "\n"), "DP-2"))
  // 70000 bytes of comment before it: absent
  assert.ok(!Dados.temRegra(Dados.regrasDoMonitorsLua("-- " + "x".repeat(70000) + "\n" + regraDp2 + "\n"), "DP-2"))
  // rule ending exactly at byte 65536 counts; one byte later it does not
  const enchimento = (n) => "-- " + "x".repeat(n - 4) + "\n"   // n bytes, newline included
  const antes = 65536 - regraDp2.length
  assert.equal(Buffer.byteLength(enchimento(antes) + regraDp2), 65536)
  assert.ok(Dados.temRegra(Dados.regrasDoMonitorsLua(enchimento(antes) + regraDp2 + "\n"), "DP-2"))
  assert.ok(!Dados.temRegra(Dados.regrasDoMonitorsLua(enchimento(antes + 1) + regraDp2 + "\n"), "DP-2"))
  // the byte cut counts UTF-8, not UTF-16 units
  const acentos = "-- " + "é".repeat(32765) + "\n"   // 3 + 65530 + 1 = 65534 bytes, 32769 units
  assert.ok(!Dados.temRegra(Dados.regrasDoMonitorsLua(acentos + regraDp2 + "\n"), "DP-2"))
})

// ---- lerTsv ----

test("lerTsv segue o esperado.txt", () => {
  const linhas = linhasDoEsperado()
  assert.equal(linhas.length, 27)
  for (const [arquivo, esperado] of linhas) {
    const r = Dados.lerTsv(fixture("tsv/" + arquivo))
    assert.equal(r.ok ? "valido" : r.linha + ":" + r.motivo, esperado, arquivo)
  }
})
test("lerTsv devolve as entradas com números", () => {
  const r = Dados.lerTsv(fixture("tsv/valido-2telas.tsv"))
  assert.deepEqual(plain(r), { ok: true, entradas: [entradaRtk(), entradaLg()] })
  assert.deepEqual(plain(Dados.lerTsv(fixture("tsv/valido-injecao.tsv")).entradas[0].desc), INJECAO)
})
test("lerTsv: recusa tem só ok, linha e motivo", () => {
  assert.deepEqual(plain(Dados.lerTsv(fixture("tsv/invalido-modo.tsv"))), { ok: false, linha: 3, motivo: "modo" })
})
test("lerTsv: colunas, visto, linha depois do fim e n que não é número", () => {
  assert.equal(lerTexto(CAB + RTK + "\tDP-1\t1920x1080@60.00\t2048\t36\t0\n" + "fim\t1\n"), "3:colunas")
  assert.equal(lerTexto(CAB + RTK + "\tDP-1\t1920x1080@60.00\t2048\t36\t0\t2026-11-20\textra\n" + "fim\t1\n"), "3:colunas")
  assert.equal(lerTexto(CAB + RTK + "\tDP-1\t1920x1080@60.00\t2048\t36\t0\t20/11/2026\n" + "fim\t1\n"), "3:visto")
  assert.equal(lerTexto(CAB + LINHA_RTK + "fim\t1\n\n" + LINHA_LG), "6:fim")
  assert.equal(lerTexto(CAB + LINHA_RTK + "fim\t1\n# comentário depois\n"), "5:fim")
  assert.equal(lerTexto(CAB + LINHA_RTK + "fim\tum\n"), "4:contagem")
  assert.equal(lerTexto(CAB + LINHA_RTK + "fim\t1\n\n\n"), "valido")
})
test("lerTsv: ordem das checagens", () => {
  // a long line anywhere wins over a bad header
  assert.equal(lerTexto("# outra coisa\n" + LINHA_RTK + "# " + "x".repeat(600) + "\nfim\t1\n"), "3:linhaLonga")
  // a line of exactly 512 bytes is fine
  assert.equal(lerTexto(CAB + "# " + "x".repeat(510) + "\n" + LINHA_RTK + "fim\t1\n"), "valido")
  // the size limit counts UTF-8 bytes
  const comentario = "# " + "é".repeat(200) + "\n"            // 403 bytes, 203 units
  assert.equal(lerTexto(CAB + comentario.repeat(19) + LINHA_RTK + "fim\t1\n"), "valido")
  assert.equal(lerTexto(CAB + comentario.repeat(21) + LINHA_RTK + "fim\t1\n"), "0:bytes")
  // fields in order: desc before porta before modo
  assert.equal(lerTexto(CAB + "a\u0001b\teDP-1\tx\t0\t0\t0\t2026-11-20\nfim\t1\n"), "3:desc")
  assert.equal(lerTexto(CAB + "Tela\teDP-1\tx\t0\t0\t0\t2026-11-20\nfim\t1\n"), "3:portaInterna")
  // repeated port is reported before repeated desc
  assert.equal(lerTexto(CAB + LINHA_RTK + LINHA_RTK + "fim\t2\n"), "4:portaRepetida")
  // after fim, then count
  assert.equal(lerTexto(CAB + LINHA_RTK + "fim\t5\nlixo\n"), "5:fim")
  // empty file and a file with only the header
  assert.equal(lerTexto(""), "1:cabecalho")
  assert.equal(lerTexto(CAB), "2:fim")
  assert.equal(lerTexto(CAB + "fim\t0\n"), "valido")
})
test("lerTsv: desc e porta '-' não repetem, e 32 telas passam", () => {
  const sem = (porta, desc) => desc + "\t" + porta + "\t1920x1080@60.00\t0\t0\t0\t2026-11-20\n"
  assert.equal(lerTexto(CAB + sem("-", RTK) + sem("-", LG) + sem("DP-1", "-") + sem("DP-2", "-") + "fim\t4\n"), "valido")
  let trinta2 = ""
  for (let i = 1; i <= 32; i++) trinta2 += sem("DP-" + i, "Tela teste " + i)
  assert.equal(lerTexto(CAB + trinta2 + "fim\t32\n"), "valido")
})
test("lerTsv: posição no limite de 32768", () => {
  const pos = (x) => CAB + RTK + "\tDP-1\t1920x1080@60.00\t" + x + "\t0\t0\t2026-11-20\nfim\t1\n"
  assert.equal(lerTexto(pos("32768")), "valido")
  assert.equal(lerTexto(pos("-32768")), "valido")
  assert.equal(lerTexto(pos("32769")), "3:posicao")
  assert.equal(lerTexto(pos("123456")), "3:posicao")
  assert.equal(lerTexto(pos("1.5")), "3:posicao")
  assert.equal(lerTexto(pos("+5")), "3:posicao")
})

// ---- escreverTsv ----

test("escreverTsv grava o valido-2telas.tsv byte a byte, na ordem do Ruling 13", () => {
  const entradas = [entradaLg(), entradaRtk()]
  const r = Dados.escreverTsv(entradas)
  assert.equal(r.ok, true)
  assert.equal(r.texto, fixture("tsv/valido-2telas.tsv"))
  assert.equal(entradas[0].porta, "HDMI-A-4")   // input order untouched
})
test("escreverTsv e lerTsv vão e voltam iguais", () => {
  const entradas = [
    { desc: INJECAO, porta: "DP-3", modo: "1920x1080@60.00", x: 4000, y: -36, transform: 1, visto: "2026-11-19" },
    { desc: "é".repeat(128), porta: "-", modo: "800x600@50", x: -32768, y: 32768, transform: 3, visto: "2026-01-02" },
    { desc: "-", porta: "DP-2", modo: "2560x1440@144", x: 0, y: 0, transform: 2, visto: "2026-11-20" },
    entradaLg(), entradaRtk(),
  ]
  const escrito = Dados.escreverTsv(entradas)
  assert.equal(escrito.ok, true)
  const lido = Dados.lerTsv(escrito.texto)
  assert.equal(lido.ok, true)
  const ordem = (a, b) => (a.porta === "-") - (b.porta === "-") || (a.porta < b.porta ? -1 : a.porta > b.porta ? 1 : 0) || (a.desc < b.desc ? -1 : 1)
  assert.deepEqual(plain(lido.entradas), entradas.slice().sort(ordem))
  assert.deepEqual(plain(lido.entradas).map((e) => e.porta), ["DP-1", "DP-2", "DP-3", "HDMI-A-4", "-"])
  assert.equal(Dados.escreverTsv(plain(lido.entradas)).texto, escrito.texto)
})
test("escreverTsv: com a mesma porta '-', ordena pela desc", () => {
  const e = (desc) => ({ desc, porta: "-", modo: "1920x1080@60.00", x: 0, y: 0, transform: 0, visto: "2026-11-20" })
  const r = Dados.lerTsv(Dados.escreverTsv([e("Tela b"), e("Tela B"), e("Tela a")]).texto)
  assert.deepEqual(plain(r.entradas).map((x) => x.desc), ["Tela B", "Tela a", "Tela b"])
})
test("escreverTsv recusa o que o lerTsv recusaria", () => {
  const com = (extra) => [Object.assign(entradaRtk(), extra)]
  const motivo = (entradas) => plain(Dados.escreverTsv(entradas))
  assert.deepEqual(motivo(com({ desc: "a\tb" })), { ok: false, motivo: "desc" })
  assert.deepEqual(motivo(com({ desc: undefined })), { ok: false, motivo: "desc" })
  assert.deepEqual(motivo(com({ porta: 'DP-1"x' })), { ok: false, motivo: "porta" })
  assert.deepEqual(motivo(com({ porta: "eDP-1" })), { ok: false, motivo: "portaInterna" })
  assert.deepEqual(motivo(com({ modo: "1920x1080" })), { ok: false, motivo: "modo" })
  assert.deepEqual(motivo(com({ x: 40000 })), { ok: false, motivo: "posicao" })
  assert.deepEqual(motivo(com({ y: 1.5 })), { ok: false, motivo: "posicao" })
  assert.deepEqual(motivo(com({ x: "12" })), { ok: false, motivo: "posicao" })
  assert.deepEqual(motivo(com({ transform: 4 })), { ok: false, motivo: "transform" })
  assert.deepEqual(motivo(com({ visto: "ontem" })), { ok: false, motivo: "visto" })
  assert.deepEqual(motivo([entradaRtk(), Object.assign(entradaLg(), { porta: "DP-1" })]), { ok: false, motivo: "portaRepetida" })
  assert.deepEqual(motivo([entradaRtk(), Object.assign(entradaLg(), { desc: RTK })]), { ok: false, motivo: "descRepetida" })
  const muitas = []
  for (let i = 1; i <= 33; i++) muitas.push({ desc: "Tela teste " + i, porta: "DP-" + i, modo: "1920x1080@60.00", x: 0, y: 0, transform: 0, visto: "2026-11-20" })
  assert.deepEqual(motivo(muitas), { ok: false, motivo: "linhas" })
  assert.equal(Dados.escreverTsv(muitas.slice(0, 32)).ok, true)
  assert.deepEqual(motivo(null), { ok: false, motivo: "colunas" })
  assert.deepEqual(motivo([null]), { ok: false, motivo: "colunas" })
})
test("escreverTsv recusa linha acima de 512 bytes e arquivo acima de 8 KiB", () => {
  const longa = Object.assign(entradaRtk(), { desc: "😀".repeat(128) })   // 512 bytes of desc alone
  assert.deepEqual(plain(Dados.escreverTsv([longa])), { ok: false, motivo: "linhaLonga" })
  const grandes = []
  for (let i = 1; i <= 32; i++) grandes.push({ desc: "é".repeat(120) + i, porta: "DP-" + i, modo: "1920x1080@60.00", x: 0, y: 0, transform: 0, visto: "2026-11-20" })
  assert.deepEqual(plain(Dados.escreverTsv(grandes)), { ok: false, motivo: "bytes" })
})

// ---- montarEval e montarNeutralizacao ----

test("montarEval põe todas as desc: antes de todas as portas", () => {
  const r = Dados.montarEval([alvo("DP-1", RTK), alvo("HDMI-A-4", LG, { modo: "2560x1080@75", x: -256, y: -1080 })], regras)
  assert.equal(r.ok, true)
  assert.equal(r.trecho, [
    'hl.monitor({ output = "desc:' + RTK + '", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })',
    'hl.monitor({ output = "desc:' + LG + '", mode = "2560x1080@75", position = "-256x-1080", transform = 0 })',
    'hl.monitor({ output = "DP-1", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })',
    'hl.monitor({ output = "HDMI-A-4", mode = "2560x1080@75", position = "-256x-1080", transform = 0 })',
  ].join("\n"))
})
test("montarEval: desc sem regra desc: e desc '-' saem só pela porta", () => {
  const r = Dados.montarEval([alvo("DP-1", "Tela nova inventada", { transform: 1 }), alvo("HDMI-A-4", "-")], regras)
  assert.equal(r.trecho, [
    'hl.monitor({ output = "DP-1", mode = "1920x1080@60.00", position = "2048x36", transform = 1 })',
    'hl.monitor({ output = "HDMI-A-4", mode = "1920x1080@60.00", position = "2048x36", transform = 0 })',
  ].join("\n"))
})
test("montarEval recusa porta hostil", () => {
  const r = Dados.montarEval([{ porta: 'DP-1", disabled = true, x = "', desc: "-", modo: "1920x1080@60.00", x: 0, y: 0, transform: 0 }], regras)
  assert.deepEqual(plain(r), { ok: false, motivo: "porta" })
})
test("montarEval recusa porta interna e porta sem regra", () => {
  assert.ok(Dados.temRegra(regras, "eDP-1"))   // the internal port does have a hand-written rule
  assert.deepEqual(plain(Dados.montarEval([alvo("DP-1", RTK), alvo("eDP-1", "AU Optronics 0x1396")], regras)), { ok: false, motivo: "interna" })
  assert.deepEqual(plain(Dados.montarEval([alvo("DP-1", RTK), alvo("DP-2", "Tela nova inventada")], regras)), { ok: false, motivo: "semRegra" })
  assert.deepEqual(plain(Dados.montarEval([alvo("-", RTK)], regras)), { ok: false, motivo: "semRegra" })
})
test("montarEval revalida desc, modo, posição e transform", () => {
  const recusa = (extra) => plain(Dados.montarEval([alvo("DP-1", RTK), alvo("HDMI-A-4", LG, extra)], regras))
  assert.deepEqual(recusa({ desc: "a\nb" }), { ok: false, motivo: "desc" })
  assert.deepEqual(recusa({ desc: "" }), { ok: false, motivo: "desc" })
  assert.deepEqual(recusa({ modo: "preferred" }), { ok: false, motivo: "modo" })
  assert.deepEqual(recusa({ modo: '1920x1080@60", scale = "2' }), { ok: false, motivo: "modo" })
  assert.deepEqual(recusa({ x: 40000 }), { ok: false, motivo: "posicao" })
  assert.deepEqual(recusa({ y: "0" }), { ok: false, motivo: "posicao" })
  assert.deepEqual(recusa({ x: 0.5 }), { ok: false, motivo: "posicao" })
  assert.deepEqual(recusa({ transform: 5 }), { ok: false, motivo: "transform" })
  assert.deepEqual(recusa({ transform: "1" }), { ok: false, motivo: "transform" })
})
test("montarEval escapa a desc e um Lua de verdade lê igual", () => {
  const desc = 'Tela "teste" \\ barra'
  // a quote inside the name never reads as a rule from monitors.lua, so the map is built by hand
  const r2 = Object.assign({}, plain(regras), { ["desc:" + desc]: { modo: null, posicao: null, escala: null, transform: 0 } })
  const r = Dados.montarEval([alvo("DP-1", desc)], r2)
  assert.equal(r.ok, true)
  assert.ok(r.trecho.includes('output = "desc:Tela \\"teste\\" \\\\ barra"'))
  const lua = rodarNoLua(r.trecho)
  assert.equal(lua.status, 0, lua.stderr)
  assert.equal(lua.saida[0].output, 'desc:Tela "teste" \\ barra')
  assert.equal(lua.saida[1].output, "DP-1")
})
test("montarEval: desc hostil continua sendo só valor num Lua de verdade", () => {
  for (const desc of [INJECAO, '", scale = 2, disabled = true, x = "', "\\", 'fim \\" ]] -- [[']) {
    const r2 = Object.assign({}, plain(regras), { ["desc:" + desc]: { modo: null, posicao: null, escala: null, transform: 0 } })
    const r = Dados.montarEval([alvo("DP-1", desc)], r2)
    assert.equal(r.ok, true, desc)
    const lua = rodarNoLua(r.trecho)
    assert.equal(lua.status, 0, desc + ": " + lua.stderr)
    assert.deepEqual(lua.saida, [
      { output: "desc:" + desc, chaves: "mode,output,position,transform" },
      { output: "DP-1", chaves: "mode,output,position,transform" },
    ], desc)
  }
})
test("nenhum trecho gerado contém scale", () => {
  const trechos = [
    Dados.montarEval([alvo("DP-1", RTK), alvo("HDMI-A-4", LG)], regras).trecho,
    Dados.montarEval([alvo("DP-1", "-"), alvo("HDMI-A-4", "Tela nova inventada")], regras).trecho,
    Dados.montarNeutralizacao("DP-1", regras).trecho,
    Dados.montarNeutralizacao("HDMI-A-4", regras).trecho,
  ]
  for (const trecho of trechos) {
    assert.equal(typeof trecho, "string")
    assert.doesNotMatch(trecho, PROIBIDOS)
  }
  const lua = rodarNoLua(trechos[0])
  assert.equal(lua.status, 0, lua.stderr)
  assert.equal(lua.saida.length, 4)
  for (const chamada of lua.saida) assert.equal(chamada.chaves, "mode,output,position,transform")
})
test("montarNeutralizacao", () => {
  assert.equal(Dados.montarNeutralizacao("DP-1", regras).trecho, 'hl.monitor({ output = "DP-1", mode = "preferred", transform = 0 })')
  assert.deepEqual(plain(Dados.montarNeutralizacao("HDMI-A-4", regras)), { ok: true, trecho: 'hl.monitor({ output = "HDMI-A-4", mode = "preferred", transform = 0 })' })
  assert.deepEqual(plain(Dados.montarNeutralizacao("eDP-1", regras)), { ok: false, motivo: "interna" })
  assert.deepEqual(plain(Dados.montarNeutralizacao("DP-2", regras)), { ok: false, motivo: "semRegra" })
  assert.deepEqual(plain(Dados.montarNeutralizacao('DP-1" })', regras)), { ok: false, motivo: "porta" })
  const lua = rodarNoLua(Dados.montarNeutralizacao("DP-1", regras).trecho)
  assert.deepEqual(lua.saida, [{ output: "DP-1", chaves: "mode,output,transform" }])
})

// ---- Task 5: compare, merge, forget, seed, ghosts, read-back ----

const Geo = carregar("Geometria.js")
const HOJE = "2026-11-20"
const INVENTADA = "Tela inventada de teste"
// Every connected screen of the fixture, as plain objects (telas + fora).
const vivasTodas = () => {
  const r = Geo.lerMonitores(fixture("monitores-3telas.json"), regras)
  return plain(r.telas.concat(r.fora))
}
const vivasSemLg = () => vivasTodas().filter((t) => t.porta !== "HDMI-A-4")
const comTela = (vivas, porta, extra) => vivas.map((t) => (t.porta === porta ? Object.assign({}, t, extra) : t))
const entrada = (desc, porta, extra) => Object.assign({ desc, porta, modo: "1920x1080@60.00", x: 4000, y: 0, transform: 0, visto: "2026-11-01" }, extra || {})
const semearTexto = (vivas, rg) => {
  const r = Dados.semear(vivas, rg, false, HOJE)
  assert.equal(r.ok, true, JSON.stringify(plain(r)))
  return Dados.escreverTsv(r.entradas).texto
}
const porChave = (lista) => plain(lista).map((e) => e.desc + "|" + e.porta).sort()

test("semear com o LG desplugado grava a portátil ao vivo e o LG pela regra com a porta par", () => {
  const r = Dados.semear(vivasSemLg(), regras, false, HOJE)
  assert.equal(r.ok, true)
  const texto = Dados.escreverTsv(r.entradas).texto
  assert.equal(texto,
    "# cateim.arranjo-telas v1\n# gerado pelo painel de arranjo das telas; não edite à mão\n" +
    "Invalid Vendor Codename - RTK FHD demoset-1\tDP-1\t1920x1080@60.00\t2048\t36\t0\t2026-11-20\n" +
    "LG Electronics LG ULTRAWIDE 0x0003B53D\tHDMI-A-4\t2560x1080@75\t-256\t-1080\t0\t2026-11-20\n" +
    "fim\t2\n")
  assert.equal(texto, fixture("tsv/valido-2telas.tsv"))
})
test("semear com o LG ligado grava as duas externas ao vivo", () => {
  const texto = semearTexto(vivasTodas(), regras)
  assert.equal(texto, CAB + LINHA_RTK + LG + "\tHDMI-A-4\t2560x1080@74.99\t-256\t-1080\t0\t2026-11-20\nfim\t2\n")
})
test("semear sem porta par recusa e cita a tela", () => {
  const semHdmi = monitorsLua.split("\n").filter((l) => !l.startsWith('hl.monitor({ output = "HDMI-A-4"')).join("\n")
  const rg = Dados.regrasDoMonitorsLua(semHdmi)
  assert.equal(Dados.temRegra(rg, "HDMI-A-4"), false)
  assert.deepEqual(plain(Dados.semear(vivasSemLg(), rg, false, HOJE)), { ok: false, motivo: "semPar", tela: LG })
  // A desc: rule whose mode is not a literal mode cannot be written either.
  const preferido = monitorsLua.replace('mode = "2560x1080@75", position = "-256x-1080"', 'mode = "preferred", position = "-256x-1080"')
  assert.deepEqual(plain(Dados.semear(vivasSemLg(), Dados.regrasDoMonitorsLua(preferido), false, HOJE)),
    { ok: false, motivo: "semPar", tela: LG })
})
test("semear: porta par ocupada ao vivo fica com a tela viva, a da regra vai com -", () => {
  // The portable screen unplugged, a new screen on DP-1; the RTK desc: rule pairs with DP-1.
  const vivas = comTela(vivasTodas(), "DP-1", { desc: INVENTADA })
  const r = Dados.semear(vivas, regras, false, HOJE)
  assert.equal(r.ok, true)
  const linhas = plain(r.entradas).map((e) => e.desc + "|" + e.porta + "|" + e.modo).sort()
  assert.deepEqual(linhas, [
    INVENTADA + "|DP-1|1920x1080@60.00",
    RTK + "|-|1920x1080@60",
    LG + "|HDMI-A-4|2560x1080@74.99",
  ].sort())
  assert.equal(Dados.escreverTsv(r.entradas).ok, true)
})
test("semear: tela desligada com regra desc: entra pela regra", () => {
  const vivas = comTela(vivasTodas(), "HDMI-A-4", { ligada: false })
  assert.equal(semearTexto(vivas, regras), fixture("tsv/valido-2telas.tsv"))
})
test("semear recusa arquivo existente, eDP-1 fora de 0x0 ou desligado, e arranjo que bloqueia", () => {
  assert.deepEqual(plain(Dados.semear(vivasSemLg(), regras, true, HOJE)), { ok: false, motivo: "existe", tela: "" })
  assert.deepEqual(plain(Dados.semear(comTela(vivasSemLg(), "eDP-1", { x: 10 }), regras, false, HOJE)),
    { ok: false, motivo: "edp1", tela: "eDP-1" })
  assert.deepEqual(plain(Dados.semear(comTela(vivasSemLg(), "eDP-1", { y: -5 }), regras, false, HOJE)),
    { ok: false, motivo: "edp1", tela: "eDP-1" })
  assert.deepEqual(plain(Dados.semear(comTela(vivasSemLg(), "eDP-1", { ligada: false }), regras, false, HOJE)),
    { ok: false, motivo: "edp1", tela: "eDP-1" })
  assert.deepEqual(plain(Dados.semear(vivasSemLg().filter((t) => t.porta !== "eDP-1"), regras, false, HOJE)),
    { ok: false, motivo: "edp1", tela: "" })
  // DP-1 far to the right: an island.
  assert.deepEqual(plain(Dados.semear(comTela(vivasSemLg(), "DP-1", { x: 3000 }), regras, false, HOJE)),
    { ok: false, motivo: "bloqueia", tela: "DP-1" })
  // DP-1 over the internal screen: an overlap; the external screen is the one named.
  assert.deepEqual(plain(Dados.semear(comTela(vivasSemLg(), "DP-1", { x: 1000 }), regras, false, HOJE)),
    { ok: false, motivo: "bloqueia", tela: "DP-1" })
  // The contract: semear takes raw screens. Normalized, the internal one is always at 0x0.
  const deslocadas = comTela(comTela(vivasSemLg(), "eDP-1", { x: 10 }), "DP-1", { x: 2058 })
  assert.equal(Dados.semear(deslocadas, regras, false, HOJE).motivo, "edp1")
  assert.equal(Dados.semear(plain(Geo.normalizar(deslocadas).telas), regras, false, HOJE).ok, true)
  // The order of the checks: existe first.
  assert.equal(Dados.semear(comTela(vivasSemLg(), "eDP-1", { x: 10 }), regras, true, HOJE).motivo, "existe")
})
test("semear nunca grava tela interna, tela sem regra nem tela invertida", () => {
  const vivas = comTela(comTela(vivasTodas(), "DP-1", { porta: "DP-2" }), "HDMI-A-4", { transform: 5 })
  // DP-2 has no rule and is a fixed obstacle; the RTK and the LG are live, so neither comes from its rule.
  const r = Dados.semear(vivas, regras, false, HOJE)
  assert.equal(r.ok, true, JSON.stringify(plain(r)))
  assert.deepEqual(plain(r.entradas), [])
})
test("modoCanonico: 75, 74.99 e 75.00 viram a mesma entrada; 59.94 continua outra", () => {
  const modos = ["2560x1080@74.99Hz", "2560x1080@60.00Hz"]
  assert.equal(Dados.modoCanonico("2560x1080@75", modos), "2560x1080@74.99")
  assert.equal(Dados.modoCanonico("2560x1080@74.99", modos), "2560x1080@74.99")
  assert.equal(Dados.modoCanonico("2560x1080@75.00", modos), "2560x1080@74.99")
  assert.equal(Dados.modoCanonico("2560x1080@60", modos), "2560x1080@60.00")
  const dp1 = ["1920x1080@60.00Hz", "1920x1080@60.00Hz", "1920x1080@59.94Hz"]
  assert.equal(Dados.modoCanonico("1920x1080@60.00", dp1), "1920x1080@60.00")
  assert.equal(Dados.modoCanonico("1920x1080@59.94", dp1), "1920x1080@59.94")
  assert.notEqual(Dados.modoCanonico("1920x1080@60.00", dp1), Dados.modoCanonico("1920x1080@59.94", dp1))
  assert.equal(Dados.modoCanonico("1280x720@60", dp1), null)
  assert.equal(Dados.modoCanonico("preferred", dp1), null)
  assert.equal(Dados.modoCanonico("1920x1080@60", null), null)
})
test("mesmoModo compara largura, altura e taxa com tolerância", () => {
  assert.equal(Dados.mesmoModo("1920x1080@60.00", "1920x1080@59.94", 0.5), true)
  assert.equal(Dados.mesmoModo("1920x1080@60.00", "1920x1080@59.94", 0), false)
  assert.equal(Dados.mesmoModo("2560x1080@75", "2560x1080@74.99", 0.5), true)
  assert.equal(Dados.mesmoModo("2560x1080@75", "2560x1080@74.5", 0.5), true)
  assert.equal(Dados.mesmoModo("2560x1080@75", "2560x1080@74.49", 0.5), false)
  assert.equal(Dados.mesmoModo("2560x1080@60", "1920x1080@60", 0.5), false)
  assert.equal(Dados.mesmoModo("preferred", "preferred", 0.5), false)
})
test("chaveTela e descDoAlvo: desc repetida vira porta e -", () => {
  const vivas = vivasTodas()
  const dp1 = vivas.find((t) => t.porta === "DP-1")
  assert.equal(Dados.chaveTela(dp1, vivas), "desc:" + RTK)
  assert.equal(Dados.descDoAlvo(dp1, vivas), RTK)
  const gemeas = comTela(vivas, "HDMI-A-4", { desc: RTK })
  const lg = gemeas.find((t) => t.porta === "HDMI-A-4")
  assert.equal(Dados.chaveTela(lg, gemeas), "porta:HDMI-A-4")
  assert.equal(Dados.descDoAlvo(lg, gemeas), "-")
  assert.equal(Dados.chaveTela(gemeas.find((t) => t.porta === "DP-1"), gemeas), "porta:DP-1")
  // A desc the TSV cannot hold (empty) has no identity by desc either.
  const vazia = Object.assign({}, dp1, { desc: "" })
  assert.equal(Dados.descDoAlvo(vazia, [vazia]), "-")
  assert.equal(Dados.chaveTela(vazia, [vazia]), "porta:DP-1")
})
test("conhecida: pelo TSV, pela regra desc: ou, com desc repetida, pela porta", () => {
  const vivas = vivasTodas()
  const lg = vivas.find((t) => t.porta === "HDMI-A-4")
  const nova = Object.assign({}, lg, { desc: INVENTADA })
  const comNova = comTela(vivas, "HDMI-A-4", { desc: INVENTADA })
  assert.equal(Dados.conhecida(lg, null, regras, vivas), true)              // desc: rule only
  assert.equal(Dados.conhecida(nova, null, regras, comNova), false)
  assert.equal(Dados.conhecida(nova, [entrada(INVENTADA, "-")], regras, comNova), true)
  assert.equal(Dados.conhecida(nova, [entrada("Outra inventada", "HDMI-A-4")], regras, comNova), false)
  // Two equal screens: compared by port, desc rule ignored.
  const gemeas = comTela(vivas, "HDMI-A-4", { desc: RTK })
  const g = gemeas.find((t) => t.porta === "HDMI-A-4")
  assert.equal(Dados.conhecida(g, null, regras, gemeas), false)
  assert.equal(Dados.conhecida(g, [entrada("-", "HDMI-A-4")], regras, gemeas), true)
  assert.equal(Dados.conhecida(g, [entrada(RTK, "HDMI-A-4")], regras, gemeas), true)
  assert.equal(Dados.conhecida(g, [entrada("-", "DP-1")], regras, gemeas), false)
  assert.equal(Dados.conhecida(g, [entrada(INVENTADA, "HDMI-A-4")], regras, gemeas), false)
})
test("diferencas com a taxa arredondada: LG salvo @75 e ao vivo 74.99 não difere", () => {
  const salvo = [entradaRtk(), entradaLg()]
  assert.deepEqual(plain(Dados.diferencas(vivasTodas(), salvo, regras)), [])
  // 60.00 against a saved 59.94 still is a mode change.
  const r = plain(Dados.diferencas(vivasTodas(), [Object.assign(entradaRtk(), { modo: "1920x1080@59.94" }), entradaLg()], regras))
  assert.deepEqual(r, [{ porta: "DP-1", desc: RTK, campos: ["modo"] }])
})
test("diferencas: igual ao salvo é vazio; posição, modo, transform, porta e sem linha aparecem", () => {
  const salvo = [entradaRtk(), entradaLg()]
  const vivas = vivasTodas()
  assert.deepEqual(plain(Dados.diferencas(vivas, salvo, regras)), [])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "DP-1", { x: 2049 }), salvo, regras)),
    [{ porta: "DP-1", desc: RTK, campos: ["posicao"] }])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "DP-1", { y: 0 }), salvo, regras)),
    [{ porta: "DP-1", desc: RTK, campos: ["posicao"] }])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "HDMI-A-4", { modo: "2560x1080@60.00" }), salvo, regras)),
    [{ porta: "HDMI-A-4", desc: LG, campos: ["modo"] }])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "DP-1", { transform: 1, x: 3000 }), salvo, regras)),
    [{ porta: "DP-1", desc: RTK, campos: ["posicao", "transform"] }])
  const trocadas = [Object.assign(entradaRtk(), { porta: "-" }), entradaLg()]
  assert.deepEqual(plain(Dados.diferencas(vivas, trocadas, regras)), [{ porta: "DP-1", desc: RTK, campos: ["porta"] }])
  assert.deepEqual(plain(Dados.diferencas(vivas, [entradaLg()], regras)), [{ porta: "DP-1", desc: RTK, campos: ["semLinha"] }])
  assert.deepEqual(plain(Dados.diferencas(vivas, null, regras)).map((d) => d.porta + ":" + d.campos.join(",")),
    ["DP-1:semLinha", "HDMI-A-4:semLinha"])
  // A new screen on a port with a rule is "sem linha" too (the Aplicar of spec 8.6).
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "DP-1", { desc: INVENTADA }), salvo, regras)),
    [{ porta: "DP-1", desc: INVENTADA, campos: ["semLinha"] }])
})
test("diferencas: só telas ligadas, externas, com regra, não invertidas e não espelhadas", () => {
  const vivas = vivasTodas()
  const salvo = [entradaRtk()]
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "HDMI-A-4", { ligada: false }), salvo, regras)), [])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "HDMI-A-4", { espelho: true }), salvo, regras)), [])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "HDMI-A-4", { transform: 4 }), salvo, regras)), [])
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "HDMI-A-4", { porta: "DP-2" }), salvo, regras)), [])
  // eDP-1 has a rule in monitors.lua but is internal: never a difference.
  assert.deepEqual(plain(Dados.diferencas(comTela(vivas, "eDP-1", { x: 5 }), [entradaRtk(), entradaLg()], regras)), [])
})
test("diferencas: LG só com regra desc:, sem linha no TSV, aparece como semLinha", () => {
  assert.deepEqual(plain(Dados.diferencas(vivasTodas(), [entradaRtk()], regras)),
    [{ porta: "HDMI-A-4", desc: LG, campos: ["semLinha"] }])
})
test("mesclarArranjo grava as ligadas com visto de hoje e mantém as ausentes", () => {
  const ausente = entrada(INVENTADA, "-", { visto: "2026-10-01" })
  const salvo = [Object.assign(entradaRtk(), { visto: "2026-11-01", x: 9999 }), entradaLg(), ausente]
  const vivas = comTela(vivasSemLg(), "DP-1", { x: 2048 })
  const r = plain(Dados.mesclarArranjo(salvo, vivas, regras, "2026-11-21"))
  assert.deepEqual(r.find((e) => e.desc === RTK), { desc: RTK, porta: "DP-1", modo: "1920x1080@60.00", x: 2048, y: 36, transform: 0, visto: "2026-11-21" })
  assert.deepEqual(r.find((e) => e.desc === LG), entradaLg())
  assert.deepEqual(r.find((e) => e.desc === INVENTADA), ausente)
  assert.equal(r.length, 3)
  // Live values after the confirmation: the LG goes from @75 to @74.99.
  const comLg = plain(Dados.mesclarArranjo(salvo, vivasTodas(), regras, "2026-11-21"))
  assert.equal(comLg.find((e) => e.desc === LG).modo, "2560x1080@74.99")
  assert.deepEqual(plain(Dados.diferencas(vivasTodas(), comLg, regras)), [])
  // From nothing.
  assert.equal(Dados.escreverTsv(Dados.mesclarArranjo(null, vivasSemLg(), regras, HOJE)).texto, CAB + LINHA_RTK + "fim\t1\n")
})
test("mesclarArranjo passa a porta a quem foi confirmada nela e a outra fica com -", () => {
  const salvo = [entradaRtk(), entradaLg()]
  const vivas = comTela(vivasSemLg(), "DP-1", { desc: INVENTADA })
  const r = plain(Dados.mesclarArranjo(salvo, vivas, regras, HOJE))
  assert.deepEqual(porChave(r), [INVENTADA + "|DP-1", LG + "|HDMI-A-4", RTK + "|-"].sort())
  assert.equal(Dados.escreverTsv(r).ok, true)
  // A line left with desc "-" and port "-" is dropped (Ruling 13).
  const gemea = [entrada("-", "DP-1"), entradaLg()]
  assert.deepEqual(porChave(Dados.mesclarArranjo(gemea, vivas, regras, HOJE)), [INVENTADA + "|DP-1", LG + "|HDMI-A-4"].sort())
})
test("mesclarArranjo: duas telas iguais gravam com desc - e porta", () => {
  const gemeas = comTela(vivasTodas(), "HDMI-A-4", { desc: RTK })
  const r = plain(Dados.mesclarArranjo([entradaRtk()], gemeas, regras, HOJE))
  assert.deepEqual(porChave(r), ["-|DP-1", "-|HDMI-A-4"])
  assert.equal(Dados.escreverTsv(r).ok, true)
})
test("mesclarArranjo nunca grava tela interna, tela sem regra nem tela invertida", () => {
  const vivas = comTela(comTela(vivasTodas(), "DP-1", { porta: "DP-2" }), "HDMI-A-4", { transform: 5 })
  assert.deepEqual(plain(Dados.mesclarArranjo(null, vivas, regras, HOJE)), [])
  // Their old lines stay as they were.
  const salvo = [entradaRtk(), entradaLg()]
  assert.deepEqual(porChave(Dados.mesclarArranjo(salvo, vivas, regras, HOJE)), porChave(salvo))
  assert.deepEqual(plain(Dados.mesclarArranjo(salvo, vivas, regras, HOJE)).map((e) => e.visto), ["2026-11-20", "2026-11-20"])
  // Disabled and mirrored screens are not written either.
  const fora = comTela(comTela(vivasTodas(), "DP-1", { ligada: false }), "HDMI-A-4", { espelho: true })
  assert.deepEqual(plain(Dados.mesclarArranjo(null, fora, regras, HOJE)), [])
})
test("mesclarArranjo corta acima de 24 tirando a ausente mais antiga", () => {
  // 25 ausentes com visto de 2026-01-01 a 2026-01-25 -> sai só a de 2026-01-01
  const dia = (i) => "2026-01-" + String(i).padStart(2, "0")
  const salvo = []
  for (let i = 25; i >= 1; i--) salvo.push(entrada("Tela inventada " + i, "-", { visto: dia(i), x: 4000 + i * 64 }))
  const soInterna = vivasTodas().filter((t) => t.porta === "eDP-1")
  const r = plain(Dados.mesclarArranjo(salvo, soInterna, regras, HOJE))
  assert.equal(r.length, 24)
  assert.equal(r.some((e) => e.visto === "2026-01-01"), false)
  assert.equal(r.some((e) => e.visto === "2026-01-02"), true)
  // With two live screens (27 lines), the three oldest absent ones go.
  const r2 = plain(Dados.mesclarArranjo(salvo, vivasTodas(), regras, HOJE))
  assert.equal(r2.length, 24)
  assert.deepEqual(r2.filter((e) => e.visto < "2026-01-05").map((e) => e.visto), ["2026-01-04"])
  // 24 or fewer: nothing is cut.
  assert.equal(plain(Dados.mesclarArranjo(salvo.slice(0, 24), soInterna, regras, HOJE)).length, 24)
})
test("esquecer tira só a linha da ausente e recusa tela ligada", () => {
  const ausente = entrada(INVENTADA, "-")
  const gemea = entrada("-", "DP-3")
  const salvo = [entradaRtk(), entradaLg(), ausente, gemea]
  const vivas = vivasSemLg()
  const r = Dados.esquecer(salvo, "desc:" + LG, vivas)
  assert.equal(r.ok, true)
  assert.deepEqual(porChave(r.entradas), porChave([entradaRtk(), ausente, gemea]))
  assert.deepEqual(porChave(Dados.esquecer(salvo, "porta:DP-3", vivas).entradas), porChave([entradaRtk(), entradaLg(), ausente]))
  assert.deepEqual(plain(Dados.esquecer(salvo, "desc:" + RTK, vivas)), { ok: false, motivo: "ligada" })
  assert.deepEqual(plain(Dados.esquecer(salvo, "desc:Nunca salva", vivas)), { ok: false, motivo: "ausente" })
  assert.deepEqual(plain(Dados.esquecer(salvo, "porta:-", vivas)), { ok: false, motivo: "ausente" })
  assert.deepEqual(plain(Dados.esquecer(salvo, "porta:DP-1", vivas)), { ok: false, motivo: "ausente" })
  assert.deepEqual(plain(Dados.esquecer(null, "desc:" + LG, vivas)), { ok: false, motivo: "ausente" })
  // A disabled screen is not in the arrangement: it is a ghost and can be forgotten.
  assert.equal(Dados.esquecer(salvo, "desc:" + LG, comTela(vivasTodas(), "HDMI-A-4", { ligada: false })).ok, true)
  assert.deepEqual(plain(Dados.esquecer(salvo, "desc:" + LG, vivasTodas())), { ok: false, motivo: "ligada" })
  // The input is never changed.
  assert.equal(salvo.length, 4)
})
test("fantasmas: LG ausente usa a escala da regra HDMI-A-4; sem regra, 1 aproximada", () => {
  // { x: -256, y: -1080, logW: 2560, logH: 1080, aproximada: false }
  const ausente = entrada(INVENTADA, "DP-9", { modo: "2560x1440@60", x: 4000, y: 0 })
  const salvo = [entradaRtk(), entradaLg(), ausente]
  const f = plain(Dados.fantasmas(salvo, vivasSemLg(), regras))
  assert.deepEqual(f, [
    { chave: "desc:" + LG, desc: LG, porta: "HDMI-A-4", modo: "2560x1080@75", x: -256, y: -1080, transform: 0,
      logW: 2560, logH: 1080, aproximada: false, visto: "2026-11-20" },
    { chave: "desc:" + INVENTADA, desc: INVENTADA, porta: "DP-9", modo: "2560x1440@60", x: 4000, y: 0, transform: 0,
      logW: 2560, logH: 1440, aproximada: true, visto: "2026-11-01" },
  ])
  // Live screens are never ghosts; null file has none.
  assert.deepEqual(plain(Dados.fantasmas(salvo, vivasTodas(), regras)).map((g) => g.chave), ["desc:" + INVENTADA])
  assert.deepEqual(plain(Dados.fantasmas(null, vivasSemLg(), regras)), [])
})
test("fantasmas: escala da regra desc: sem porta, transform ímpar e chave por porta", () => {
  const rg = Dados.regrasDoMonitorsLua(monitorsLua.replace(
    'output = "desc:LG Electronics LG ULTRAWIDE 0x0003B53D", mode = "2560x1080@75", position = "-256x-1080", scale = 1',
    'output = "desc:LG Electronics LG ULTRAWIDE 0x0003B53D", mode = "2560x1080@75", position = "-256x-1080", scale = 1.25'))
  const salvo = [Object.assign(entradaLg(), { porta: "-", transform: 1 }), entrada("-", "DP-1", { modo: "1920x1080@60.00" })]
  const f = plain(Dados.fantasmas(salvo, vivasSemLg().filter((t) => t.porta !== "DP-1"), rg))
  assert.deepEqual(f.map((g) => [g.chave, g.logW, g.logH, g.aproximada]), [
    ["desc:" + LG, 864, 2048, false],
    ["porta:DP-1", 1920, 1080, false],
  ])
  // A line with desc "-" and port "-" cannot be told apart: no ghost.
  assert.deepEqual(plain(Dados.fantasmas([entrada("-", "-")], vivasSemLg(), regras)), [])
})
test("bateu: 60.00 contra 59.94 bate (0,5 Hz); posição diferente não bate", () => {
  const vivas = vivasTodas()
  const esperado = [alvo("DP-1", RTK, { modo: "1920x1080@59.94" }), alvo("HDMI-A-4", LG, { modo: "2560x1080@75", x: -256, y: -1080 })]
  assert.equal(Dados.bateu(esperado, vivas), true)
  assert.equal(Dados.bateu([alvo("DP-1", RTK, { x: 2047 })], vivas), false)
  assert.equal(Dados.bateu([alvo("DP-1", RTK, { y: 37 })], vivas), false)
  assert.equal(Dados.bateu([alvo("DP-1", RTK, { transform: 2 })], vivas), false)
  assert.equal(Dados.bateu([alvo("DP-1", RTK, { modo: "1920x1080@50" })], vivas), false)
  assert.equal(Dados.bateu([alvo("DP-1", RTK, { modo: "1280x720@60" })], vivas), false)
  assert.equal(Dados.bateu([alvo("DP-2", RTK)], vivas), false)
  assert.equal(Dados.bateu([alvo("DP-1", RTK)], comTela(vivas, "DP-1", { ligada: false })), false)
  assert.equal(Dados.bateu([], vivas), true)
})
test("escalaMudou devolve a porta cuja escala120 mudou", () => {
  const vivas = vivasTodas()
  const antes = { "eDP-1": 150, "DP-1": 120, "HDMI-A-4": 120 }
  assert.deepEqual(plain(Dados.escalaMudou(antes, vivas)), [])
  assert.deepEqual(plain(Dados.escalaMudou(antes, comTela(vivas, "DP-1", { escala120: 150 }))), ["DP-1"])
  assert.deepEqual(plain(Dados.escalaMudou({ "DP-1": 120 }, comTela(vivas, "eDP-1", { escala120: 192 }))), [])
  assert.deepEqual(plain(Dados.escalaMudou({ constructor: 120 }, vivas)), [])
})
