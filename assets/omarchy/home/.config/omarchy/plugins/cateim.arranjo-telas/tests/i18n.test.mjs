// Run from the plugin directory: node --test tests/*.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import vm from "node:vm"

const IDIOMAS = ["pt-BR", "en"]
const ATALHO = "SUPER + ALT + P"
const NOTIFICACOES_COM_ATALHO = ["notif.regraCriada", "notif.vao"]
const TRAVESSOES = /[\u2013\u2014]/
const MARCADOR = /%\d+/g

// The lerTsv reason codes of Task 4, used until Dados.js exists. Once it
// does, its exported CODIGOS_MOTIVO is the source of truth.
const CODIGOS_TAREFA_4 = [
  "bytes", "linhaLonga", "cabecalho", "fim", "contagem", "colunas", "desc", "porta",
  "portaInterna", "modo", "posicao", "transform", "visto", "portaRepetida", "descRepetida", "linhas",
]

const urlCatalogo = (idioma) => new URL(`../i18n/${idioma}.json`, import.meta.url)
const texto = Object.fromEntries(IDIOMAS.map((idioma) => [idioma, readFileSync(urlCatalogo(idioma), "utf8")]))
const catalogo = Object.fromEntries(IDIOMAS.map((idioma) => [idioma, JSON.parse(texto[idioma])]))

// Dados.js is a QML `.pragma library` script with `.import` lines; drop the
// directives, stub the imported namespaces and read the constant back out.
function codigosMotivo() {
  const url = new URL("../Dados.js", import.meta.url)
  if (!existsSync(url)) return CODIGOS_TAREFA_4
  const contexto = {}
  const fonte = readFileSync(url, "utf8")
    .replace(/^\.pragma library\s*$/m, "")
    .replace(/^\.import\s+"[^"]+"\s+as\s+(\w+)\s*$/gm, (_, nome) => { contexto[nome] = {}; return "" })
  vm.runInNewContext(fonte + "\n;this.__codigos = CODIGOS_MOTIVO;", contexto)
  return Array.from(contexto.__codigos)
}

// Every form of an entry: the string itself, or each plural form.
const formas = (valor) => (typeof valor === "string" ? [valor] : Object.values(valor))
const marcadores = (s) => (s.match(MARCADOR) || []).filter((m, i, todos) => todos.indexOf(m) === i).sort()

test("os dois catálogos têm as mesmas chaves", () => {
  const chavesPt = Object.keys(catalogo["pt-BR"]).sort()
  const chavesEn = Object.keys(catalogo.en).sort()
  assert.deepEqual(chavesPt, chavesEn)
  for (const idioma of IDIOMAS) {
    for (const [chave, valor] of Object.entries(catalogo[idioma])) {
      const ok = typeof valor === "string" || (valor !== null && typeof valor === "object" && !Array.isArray(valor))
      assert.ok(ok, `${idioma} ${chave}: value must be a string or a plural object`)
      for (const forma of formas(valor)) assert.ok(typeof forma === "string" && forma.trim().length > 0, `${idioma} ${chave}: empty text`)
    }
  }
})

test("toda entrada plural tem one e other nos dois idiomas", () => {
  const plurais = Object.keys(catalogo["pt-BR"]).filter((chave) => typeof catalogo["pt-BR"][chave] === "object")
  assert.ok(plurais.includes("confirmacao.contagem"), "confirmacao.contagem must be plural")
  for (const chave of Object.keys(catalogo.en)) {
    assert.equal(typeof catalogo.en[chave] === "object", plurais.includes(chave), `${chave}: plural in one language only`)
  }
  for (const idioma of IDIOMAS) {
    for (const chave of plurais) {
      const entrada = catalogo[idioma][chave]
      assert.deepEqual(Object.keys(entrada).sort(), ["one", "other"], `${idioma} ${chave}`)
    }
  }
  assert.equal(catalogo["pt-BR"]["confirmacao.contagem"].one, "Revertendo em %1 segundo")
  assert.equal(catalogo["pt-BR"]["confirmacao.contagem"].other, "Revertendo em %1 segundos")
  assert.equal(catalogo.en["confirmacao.contagem"].one, "Reverting in %1 second")
  assert.equal(catalogo.en["confirmacao.contagem"].other, "Reverting in %1 seconds")
})

test("cada chave tem os mesmos %N nos dois idiomas", () => {
  for (const chave of Object.keys(catalogo["pt-BR"])) {
    const esperado = marcadores(formas(catalogo["pt-BR"][chave])[0])
    for (const idioma of IDIOMAS) {
      for (const forma of formas(catalogo[idioma][chave])) {
        assert.deepEqual(marcadores(forma), esperado, `${idioma} ${chave}: "${forma}"`)
      }
    }
  }
})

test("há um motivo.<código> para cada código do lerTsv", () => {
  const codigos = codigosMotivo()
  assert.ok(codigos.length > 0, "CODIGOS_MOTIVO is empty")
  for (const idioma of IDIOMAS) {
    const motivos = Object.keys(catalogo[idioma]).filter((chave) => chave.startsWith("motivo.")).sort()
    assert.deepEqual(motivos, codigos.map((codigo) => "motivo." + codigo).sort(), idioma)
  }
})

test("as notificações citam SUPER + ALT + P", () => {
  for (const idioma of IDIOMAS) {
    for (const chave of NOTIFICACOES_COM_ATALHO) {
      assert.ok(catalogo[idioma][chave].includes(ATALHO), `${idioma} ${chave}`)
    }
  }
  assert.equal(catalogo["pt-BR"]["notif.regraCriada"], "A tela %1 já pode ser posicionada. SUPER + ALT + P.")
  assert.equal(catalogo["pt-BR"]["notif.vao"], "O arranjo das telas tem um vão. SUPER + ALT + P para corrigir.")
  assert.equal(catalogo["pt-BR"]["notif.titulo"], "Arranjo das telas")
  assert.equal(catalogo["pt-BR"]["notif.guarda"], "Arranjo das telas revertido: o painel não respondeu")
})

test("nenhum texto tem travessão nem meia-risca", () => {
  for (const idioma of IDIOMAS) {
    assert.doesNotMatch(texto[idioma], TRAVESSOES, idioma)
  }
})

// ---- Task 12: texts the panel shows for refusals, and every key the QML cites ----

const lerFonte = (nome) => readFileSync(new URL(`../${nome}`, import.meta.url), "utf8")

// The body of `function <nome>(` up to the first line that is a lone "}".
function corpoDaFuncao(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`)
  assert.ok(inicio >= 0, `function ${nome} not found`)
  const fim = fonte.indexOf("\n}\n", inicio)
  return fonte.slice(inicio, fim)
}

const comPrefixo = (idioma, prefixo) =>
  Object.keys(catalogo[idioma]).filter((chave) => chave.startsWith(prefixo)).sort()

test("há um eval.<código> para cada recusa do montarEval, mais vazio", () => {
  const dados = lerFonte("Dados.js")
  const corpo = corpoDaFuncao(dados, "motivoDoAlvo") + corpoDaFuncao(dados, "montarEval")
  const codigos = new Set([...corpo.matchAll(/return\s*(?:\{[^}]*motivo:\s*)?"(\w+)"/g)].map((m) => m[1]))
  // ArranjoTelas.qml falls back to "vazio" when a chunk comes out empty.
  assert.match(lerFonte("ArranjoTelas.qml"), /"vazio"/)
  codigos.add("vazio")
  assert.ok(codigos.has("semRegra") && codigos.has("porta"), [...codigos].join(","))
  for (const idioma of IDIOMAS) {
    assert.deepEqual(comPrefixo(idioma, "eval."), [...codigos].map((c) => "eval." + c).sort(), idioma)
  }
})

test("há um redimensionar.<código> para cada recusa do Geo.redimensionar", () => {
  const corpo = corpoDaFuncao(lerFonte("Geometria.js"), "redimensionar")
  const codigos = [...new Set([...corpo.matchAll(/recusa\("(\w+)"\)/g)].map((m) => m[1]))]
  assert.deepEqual([...codigos].sort(), ["fixa", "interna", "modo", "porta", "transform"])
  for (const idioma of IDIOMAS) {
    assert.deepEqual(comPrefixo(idioma, "redimensionar."), codigos.map((c) => "redimensionar." + c).sort(), idioma)
  }
})

test("toda chave citada nos QML existe nos dois catálogos", () => {
  const arquivos = ["ArranjoTelas.qml", "PainelArranjo.qml", "AreaTelas.qml", "DetalhesTela.qml", "JanelaConfirmacao.qml"]
  const citadas = new Set()
  for (const arquivo of arquivos) {
    const fonte = lerFonte(arquivo)
    // `strings.t("motivo." + code)` style prefixes end in "." and are checked by the tests above.
    for (const m of fonte.matchAll(/(?:strings\.tn?|texto)\("([^"]+)"/g)) if (!m[1].endsWith(".")) citadas.add(m[1])
    for (const m of fonte.matchAll(/"((?:faixa|aviso|aplicar|modo|notif|confirmacao|esquecer|fantasma|fora|orientacao)\.[A-Za-z0-9]+)"/g)) citadas.add(m[1])
  }
  assert.ok(citadas.size > 20, `only ${citadas.size} keys found`)
  for (const idioma of IDIOMAS) {
    const faltando = [...citadas].filter((chave) => !(chave in catalogo[idioma]))
    assert.deepEqual(faltando, [], idioma)
  }
})
