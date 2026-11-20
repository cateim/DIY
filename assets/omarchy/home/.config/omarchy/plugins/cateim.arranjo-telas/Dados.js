.pragma library
.import "Geometria.js" as Geo

// Data and commands for the display arrangement panel, part 1: the rules in
// ~/.config/hypr/monitors.lua, the saved arrangement (monitors-arranjo.tsv)
// and the Lua chunks sent to `hyprctl eval`. The Lua loader in
// ~/.config/hypr/monitors-arranjo.lua applies the same rules and reads the
// same fixtures (tests/fixtures). Top-level values are `var` so they show up
// on the module object in QML and in node's vm; Geo is only used inside
// functions, so the module loads even with Geo stubbed.

var CABECALHO = "# cateim.arranjo-telas v1"
var COMENTARIO = "# gerado pelo painel de arranjo das telas; não edite à mão"
var MAX_LINHAS_TSV = 32          // screen lines in the saved file
var CORTE_TSV = 24               // above this, saving drops the oldest absent screens
var MAX_BYTES_TSV = 8192         // whole file, UTF-8 bytes
var MAX_BYTES_LINHA = 512        // one physical line, UTF-8 bytes, newline excluded
var MAX_DESC = 128               // desc length, in code points
var MAX_POS = 32768              // absolute value of x and y
var MAX_BYTES_MONITORS = 65536   // only this much of monitors.lua is read
var MAX_LINHAS_MONITORS = 500    // and only this many lines of it

// Every reason lerTsv can refuse with, in check order. The i18n catalogs
// carry one motivo.<code> per entry (tests/i18n.test.mjs).
var CODIGOS_MOTIVO = [
  "bytes", "utf8", "linhaLonga", "cabecalho", "fim", "contagem", "colunas", "desc", "porta",
  "portaInterna", "modo", "posicao", "transform", "visto", "portaRepetida", "descRepetida", "linhas"
]

var CAMPOS_TSV = 7
var SEM_VALOR = "-"
var INICIO_FIM = "fim\t"

var RE_PORTA = /^[A-Za-z0-9._-]{1,32}$/
var RE_MODO = /^([0-9]{3,5})x([0-9]{3,5})@([0-9]{1,3}(?:\.[0-9]{1,3})?)$/
var RE_POSICAO = /^-?[0-9]{1,5}$/
var RE_TRANSFORM = /^[0-3]$/
var RE_VISTO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
var RE_CONTAGEM = /^[0-9]+$/
// Control characters, DEL, and U+FFFD (what a bad UTF-8 byte decodes to).
var RE_DESC_PROIBIDO = /[\u0000-\u001f\u007f�]/
// A UTF-8 byte order mark at the start is skipped, as the Lua loader does,
// whether or not the reader already dropped it. U+FFFD anywhere refuses the
// file: it is what a bad byte decodes to, and the panel cannot tell a bad
// byte from a real U+FFFD, so the loader refuses both too (same file, same
// verdict on both sides).
var BOM = "\ufeff"
var SUBSTITUTO = "\ufffd"

// A rule line in monitors.lua, in the format Omarchy's persist_scale reads
// and writes: starts at column 1 with `hl.monitor({ output = "<name>",` and,
// after cutting everything from the first `--`, ends in `})` plus optional
// whitespace. Whitespace is Lua's %s: space, \t, \n, \v, \f, \r.
var RE_REGRA = /^hl\.monitor\(\{ output = "([^"]+)",/
var RE_FECHA = /\}\)[ \t\n\v\f\r]*$/
var RE_CAMPO_MODE = /[{, \t\n\v\f\r]mode[ \t\n\v\f\r]*=[ \t\n\v\f\r]*"([^"]*)"/
var RE_CAMPO_POSITION = /[{, \t\n\v\f\r]position[ \t\n\v\f\r]*=[ \t\n\v\f\r]*"([^"]*)"/
var RE_CAMPO_SCALE = /[{, \t\n\v\f\r]scale[ \t\n\v\f\r]*=[ \t\n\v\f\r]*([^,} \t\n\v\f\r]+)/
var RE_CAMPO_TRANSFORM = /[{, \t\n\v\f\r]transform[ \t\n\v\f\r]*=[ \t\n\v\f\r]*([^,} \t\n\v\f\r]+)/
var RE_NUMERO_LITERAL = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/
var RE_INTEIRO_LITERAL = /^[0-9]+$/
// A Lua long comment opener, "--[[" or "--[==[" (level = the "=" run).
var RE_ABRE_BLOCO = /^--\[(=*)\[/

// ---- text helpers ----

// UTF-8 bytes of the code point starting at texto[i]: 4 for a surrogate
// pair, 3 for a lone surrogate (an encoder writes U+FFFD in its place).
function bytesDoPonto(texto, i) {
  var c = texto.charCodeAt(i)
  if (c < 0x80) return 1
  if (c < 0x800) return 2
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < texto.length) {
    var d = texto.charCodeAt(i + 1)
    if (d >= 0xdc00 && d <= 0xdfff) return 4
  }
  return 3
}

function bytesUtf8(s) {
  var texto = String(s)
  var total = 0
  for (var i = 0; i < texto.length; i++) {
    var passo = bytesDoPonto(texto, i)
    total += passo
    if (passo === 4) i++
  }
  return total
}

// The fewest bytes the file on disk can have had: like bytesUtf8, but each
// U+FFFD counts 1 (one bad byte decodes to one U+FFFD). Exact for a text
// with no U+FFFD, the only kind lerTsv accepts.
function bytesNoDisco(texto) {
  var substitutos = texto.split(SUBSTITUTO).length - 1
  return bytesUtf8(texto) - substitutos * (bytesUtf8(SUBSTITUTO) - 1)
}

// 1-based line number of the character at index i.
function linhaDoIndice(texto, i) {
  return texto.substring(0, i).split("\n").length
}

// Code points, as Array.from(s).length and Lua's utf8.len count them.
function contarCaracteres(s) {
  var texto = String(s)
  var total = 0
  for (var i = 0; i < texto.length; i++) {
    if (bytesDoPonto(texto, i) === 4) i++
    total++
  }
  return total
}

// The longest prefix of `texto` that fits in `maximo` UTF-8 bytes, never
// splitting a code point.
function cortarBytes(texto, maximo) {
  var total = 0
  for (var i = 0; i < texto.length; i++) {
    var passo = bytesDoPonto(texto, i)
    if (total + passo > maximo) return texto.substring(0, i)
    total += passo
    if (passo === 4) i++
  }
  return texto
}

// Lines split on "\n"; a final "\n" (or an empty text) adds no line.
function linhasFisicas(texto) {
  var linhas = texto.split("\n")
  if (linhas[linhas.length - 1] === "") linhas.pop()
  return linhas
}

function escaparLua(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")
}

// ---- validators (the field rules of spec 8.3) ----

function validarDesc(s) {
  if (typeof s !== "string") return false
  var n = contarCaracteres(s)
  return n >= 1 && n <= MAX_DESC && !RE_DESC_PROIBIDO.test(s)
}

// Note: "-" itself matches the character class, so it passes.
function validarPorta(s) {
  return typeof s === "string" && RE_PORTA.test(s)
}

function validarModo(s) {
  return typeof s === "string" && RE_MODO.test(s)
}

function parseModo(s) {
  if (!validarModo(s)) return null
  var partes = RE_MODO.exec(s)
  return { w: Number(partes[1]), h: Number(partes[2]), hz: Number(partes[3]) }
}

function posicaoValida(s) {
  return RE_POSICAO.test(s) && Math.abs(Number(s)) <= MAX_POS
}

// ---- monitors.lua ----

// True when `nome` has a rule. The map has no prototype, so a name such as
// "constructor" or "__proto__" never inherits a value.
function temRegra(regras, nome) {
  return regras !== null && typeof regras === "object"
         && Object.prototype.hasOwnProperty.call(regras, nome)
}

function lerRegra(linha) {
  var cabeca = RE_REGRA.exec(linha)
  if (cabeca === null) return null
  var resto = linha.substring(cabeca[0].length)
  var corte = resto.indexOf("--")
  var codigo = corte < 0 ? resto : resto.substring(0, corte)
  if (!RE_FECHA.test(codigo)) return null
  var campos = "," + codigo
  var modo = RE_CAMPO_MODE.exec(campos)
  var posicao = RE_CAMPO_POSITION.exec(campos)
  var escala = RE_CAMPO_SCALE.exec(campos)
  var transform = RE_CAMPO_TRANSFORM.exec(campos)
  return {
    nome: cabeca[1],
    valores: {
      modo: modo === null ? null : modo[1],
      posicao: posicao === null ? null : posicao[1],
      escala: escala !== null && RE_NUMERO_LITERAL.test(escala[1]) ? Number(escala[1]) : null,
      transform: transform !== null && RE_INTEIRO_LITERAL.test(transform[1]) ? Number(transform[1]) : 0
    }
  }
}

// Index just past the "]" + nivel + "]" that closes a long comment, looking
// from `inicio`, or -1 when this line does not close it.
function fimDoBloco(linha, inicio, nivel) {
  var fecho = "]" + nivel + "]"
  var i = linha.indexOf(fecho, inicio)
  return i < 0 ? -1 : i + fecho.length
}

// The level of a long comment still open at the end of `linha`, looking from
// `inicio`, or null. Like lerRegra, the first "--" starts the comment, even
// inside a string; the Lua loader does the same.
function blocoAbertoNoFim(linha, inicio) {
  var pos = inicio
  for (var passos = 0; passos <= linha.length; passos++) {
    var traco = linha.indexOf("--", pos)
    if (traco < 0) return null
    var abre = RE_ABRE_BLOCO.exec(linha.substring(traco))
    if (abre === null) return null          // a line comment hides the rest
    var fim = fimDoBloco(linha, traco + abre[0].length, abre[1])
    if (fim < 0) return abre[1]
    pos = fim
  }
  return null
}

// Map of every output with a rule (port name or "desc:<description>") to the
// values written in it. Reads the first MAX_BYTES_MONITORS bytes, then the
// first MAX_LINHAS_MONITORS lines of those. A repeated name keeps the last
// line. The catch-all (output = "") never counts. A line inside a long
// comment (--[[ ]] or --[==[ ]==]) is not a rule. Known limit, also in the
// Lua loader: nothing is evaluated, so a rule under "if false then" or inside
// a long string still counts.
function regrasDoMonitorsLua(texto) {
  var regras = Object.create(null)
  var linhas = cortarBytes(typeof texto === "string" ? texto : "", MAX_BYTES_MONITORS).split("\n")
  var total = Math.min(linhas.length, MAX_LINHAS_MONITORS)
  var nivel = null
  for (var i = 0; i < total; i++) {
    var linha = linhas[i]
    var inicio = 0
    if (nivel !== null) {
      // a rule starts at column 1, so the rest of a closing line never is one
      inicio = fimDoBloco(linha, 0, nivel)
      if (inicio < 0) continue
    } else {
      var regra = lerRegra(linha)
      if (regra !== null) regras[regra.nome] = regra.valores
    }
    nivel = blocoAbertoNoFim(linha, inicio)
  }
  return regras
}

// ---- monitors-arranjo.tsv ----

// The first failing field of a split screen line, or "" when all pass.
function motivoDosCampos(campos) {
  if (!validarDesc(campos[0])) return "desc"
  if (!validarPorta(campos[1])) return "porta"
  if (Geo.ehInterna(campos[1])) return "portaInterna"
  if (!validarModo(campos[2])) return "modo"
  if (!posicaoValida(campos[3]) || !posicaoValida(campos[4])) return "posicao"
  if (!RE_TRANSFORM.test(campos[5])) return "transform"
  if (!RE_VISTO.test(campos[6])) return "visto"
  return ""
}

function entradaDosCampos(campos) {
  return {
    desc: campos[0], porta: campos[1], modo: campos[2],
    x: Number(campos[3]) + 0, y: Number(campos[4]) + 0,   // + 0 turns -0 into 0
    transform: Number(campos[5]), visto: campos[6]
  }
}

// All or nothing: the first problem refuses the whole file. Line numbers
// count from 1, header included; 0 means the whole file.
function lerTsv(texto) {
  var recusa = function (linha, motivo) { return { ok: false, linha: linha, motivo: motivo } }
  var bruto = typeof texto === "string" ? texto : ""
  if (bruto.charAt(0) === BOM) bruto = bruto.substring(BOM.length)
  if (bytesNoDisco(bruto) > MAX_BYTES_TSV) return recusa(0, "bytes")
  var ruim = bruto.indexOf(SUBSTITUTO)
  if (ruim >= 0) return recusa(linhaDoIndice(bruto, ruim), "utf8")
  var linhas = linhasFisicas(bruto)
  for (var i = 0; i < linhas.length; i++) {
    if (bytesUtf8(linhas[i]) > MAX_BYTES_LINHA) return recusa(i + 1, "linhaLonga")
  }
  if (linhas.length === 0 || linhas[0] !== CABECALHO) return recusa(1, "cabecalho")
  var entradas = []
  var portas = Object.create(null)
  var descs = Object.create(null)
  var linhaFim = 0
  var contagem = ""
  for (var j = 1; j < linhas.length; j++) {
    var linha = linhas[j]
    var numero = j + 1
    if (linhaFim > 0) {
      if (linha !== "") return recusa(numero, "fim")
      continue
    }
    if (linha === "" || linha.charAt(0) === "#") continue
    if (linha.indexOf(INICIO_FIM) === 0) {
      linhaFim = numero
      contagem = linha.substring(INICIO_FIM.length)
      continue
    }
    var campos = linha.split("\t")
    if (campos.length !== CAMPOS_TSV) return recusa(numero, "colunas")
    var motivo = motivoDosCampos(campos)
    if (motivo !== "") return recusa(numero, motivo)
    if (campos[1] !== SEM_VALOR && portas[campos[1]] === true) return recusa(numero, "portaRepetida")
    if (campos[0] !== SEM_VALOR && descs[campos[0]] === true) return recusa(numero, "descRepetida")
    portas[campos[1]] = true
    descs[campos[0]] = true
    entradas.push(entradaDosCampos(campos))
    if (entradas.length > MAX_LINHAS_TSV) return recusa(numero, "linhas")
  }
  if (linhaFim === 0) return recusa(Math.max(linhas.length, 1), "fim")
  if (!RE_CONTAGEM.test(contagem) || Number(contagem) !== entradas.length) return recusa(linhaFim, "contagem")
  return { ok: true, entradas: entradas }
}

function textoOuVazio(v) {
  return typeof v === "string" ? v : ""
}

// Integers only; anything else becomes "", which no field rule accepts.
function inteiroOuVazio(v) {
  return typeof v === "number" && Number.isInteger(v) ? String(v + 0) : ""
}

// Order of spec Ruling 13: by port in code order with "-" last, then desc,
// then the whole line so the result never depends on sort stability.
function compararLinhas(a, b) {
  var semA = a.porta === SEM_VALOR
  var semB = b.porta === SEM_VALOR
  if (semA !== semB) return semA ? 1 : -1
  if (a.porta !== b.porta) return a.porta < b.porta ? -1 : 1
  if (a.desc !== b.desc) return a.desc < b.desc ? -1 : 1
  if (a.texto !== b.texto) return a.texto < b.texto ? -1 : 1
  return 0
}

// Every value goes through the same rules lerTsv applies, so whatever this
// writes reads back. Refusals reuse the lerTsv codes.
function escreverTsv(entradas) {
  var recusa = function (motivo) { return { ok: false, motivo: motivo } }
  if (!Array.isArray(entradas)) return recusa("colunas")
  if (entradas.length > MAX_LINHAS_TSV) return recusa("linhas")
  var linhas = []
  var portas = Object.create(null)
  var descs = Object.create(null)
  for (var i = 0; i < entradas.length; i++) {
    var e = entradas[i]
    if (e === null || typeof e !== "object") return recusa("colunas")
    var campos = [textoOuVazio(e.desc), textoOuVazio(e.porta), textoOuVazio(e.modo), inteiroOuVazio(e.x),
                  inteiroOuVazio(e.y), inteiroOuVazio(e.transform), textoOuVazio(e.visto)]
    var motivo = motivoDosCampos(campos)
    if (motivo !== "") return recusa(motivo)
    if (campos[1] !== SEM_VALOR && portas[campos[1]] === true) return recusa("portaRepetida")
    if (campos[0] !== SEM_VALOR && descs[campos[0]] === true) return recusa("descRepetida")
    portas[campos[1]] = true
    descs[campos[0]] = true
    var texto = campos.join("\t")
    if (bytesUtf8(texto) > MAX_BYTES_LINHA) return recusa("linhaLonga")
    linhas.push({ porta: campos[1], desc: campos[0], texto: texto })
  }
  linhas.sort(compararLinhas)
  var saida = CABECALHO + "\n" + COMENTARIO + "\n"
  for (var j = 0; j < linhas.length; j++) saida += linhas[j].texto + "\n"
  saida += INICIO_FIM + linhas.length + "\n"
  if (bytesUtf8(saida) > MAX_BYTES_TSV) return recusa("bytes")
  return { ok: true, texto: saida }
}

// ---- hyprctl eval chunks ----

function linhaMonitor(output, alvo) {
  return "hl.monitor({ output = \"" + escaparLua(output) + "\", mode = \"" + alvo.modo
         + "\", position = \"" + (alvo.x + 0) + "x" + (alvo.y + 0) + "\", transform = " + alvo.transform + " })"
}

function coordenadaValida(v) {
  return typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= MAX_POS
}

// The first problem with one target, or "" when it can be sent.
function motivoDoAlvo(alvo, regras) {
  if (alvo === null || typeof alvo !== "object" || !validarPorta(alvo.porta)) return "porta"
  if (Geo.ehInterna(alvo.porta)) return "interna"
  if (!temRegra(regras, alvo.porta)) return "semRegra"
  if (!validarDesc(alvo.desc)) return "desc"
  if (!validarModo(alvo.modo)) return "modo"
  if (!coordenadaValida(alvo.x) || !coordenadaValida(alvo.y)) return "posicao"
  if (typeof alvo.transform !== "number" || !RE_TRANSFORM.test(String(alvo.transform))) return "transform"
  return ""
}

// One Lua chunk: every `desc:` line first, then every port line (spec 8.2:
// the port rule must win while the screen is on it). Only merges: a target
// whose port has no rule refuses the whole batch. Never carries scale.
function montarEval(alvos, regras) {
  if (!Array.isArray(alvos)) return { ok: false, motivo: "porta" }
  for (var i = 0; i < alvos.length; i++) {
    var motivo = motivoDoAlvo(alvos[i], regras)
    if (motivo !== "") return { ok: false, motivo: motivo }
  }
  var linhas = []
  for (var j = 0; j < alvos.length; j++) {
    var desc = alvos[j].desc
    if (desc !== SEM_VALOR && temRegra(regras, "desc:" + desc)) linhas.push(linhaMonitor("desc:" + desc, alvos[j]))
  }
  for (var k = 0; k < alvos.length; k++) linhas.push(linhaMonitor(alvos[k].porta, alvos[k]))
  return { ok: true, trecho: linhas.join("\n") }
}

// Sends a new screen back to its preferred mode, keeping the scale of the
// port rule (spec 8.7).
function montarNeutralizacao(porta, regras) {
  if (!validarPorta(porta)) return { ok: false, motivo: "porta" }
  if (Geo.ehInterna(porta)) return { ok: false, motivo: "interna" }
  if (!temRegra(regras, porta)) return { ok: false, motivo: "semRegra" }
  return { ok: true, trecho: "hl.monitor({ output = \"" + escaparLua(porta) + "\", mode = \"preferred\", transform = 0 })" }
}

// ---- Part 2: compare, merge, forget, seed, ghosts, read-back ----
// `vivas` is every connected screen as Geo.lerTela builds it: the `telas`
// plus the `fora` of Geo.lerMonitores (disabled and mirrored ones included).
// semear and bateu take them raw, as `hyprctl monitors all -j` reports them
// (semear must see the internal screen off 0x0 to refuse; bateu compares what
// the eval wrote). diferencas, mesclarArranjo, fantasmas, conhecida and
// esquecer take them after Geo.normalizar. A screen is in the
// arrangement ("ativa") when it is enabled and not mirrored; a saved line no
// active screen claims is absent (a ghost), even if its screen is plugged in
// but disabled. Nothing here changes its input.

var TOLERANCIA_HZ = 0.5          // read-back tolerance on the refresh rate (spec 8.6, step 1.5)
var EPSILON_HZ = 1e-6            // float noise on top of a tolerance
var ESCALA_APROXIMADA = 1        // ghost scale when no rule gives one (Ruling 13)
var RE_MODO_DISPONIVEL = /^([0-9]+)x([0-9]+)@([0-9]+(?:\.[0-9]+)?)Hz$/
var RE_POSICAO_REGRA = /^(-?[0-9]{1,5})x(-?[0-9]{1,5})$/
var PREFIXO_DESC = "desc:"
var PREFIXO_PORTA = "porta:"

function ativa(tela) {
  return tela !== null && typeof tela === "object" && tela.ligada !== false && tela.espelho !== true
}

function listaOuVazia(v) {
  return Array.isArray(v) ? v : []
}

// Enabled, not mirrored, external, on a port with a rule, transform 0 to 3:
// the screens the panel may move and write. Computed from the `regras` given,
// not from the `movel` flag the screen got when it was read.
function gravavel(tela, regras) {
  return ativa(tela) && validarPorta(tela.porta) && tela.porta !== SEM_VALOR && !Geo.ehInterna(tela.porta)
         && temRegra(regras, tela.porta) && typeof tela.transform === "number" && RE_TRANSFORM.test(String(tela.transform))
}

// The desc a target or a saved line carries: "-" when another connected
// screen has the same desc (spec 8.8), or when the TSV could not hold it.
function descDoAlvo(tela, vivas) {
  var desc = tela.desc
  if (desc === SEM_VALOR || !validarDesc(desc)) return SEM_VALOR
  var lista = listaOuVazia(vivas)
  var iguais = 0
  for (var i = 0; i < lista.length; i++) if (lista[i] !== null && typeof lista[i] === "object" && lista[i].desc === desc) iguais++
  return iguais > 1 ? SEM_VALOR : desc
}

function chaveTela(tela, vivas) {
  var desc = descDoAlvo(tela, vivas)
  return desc !== SEM_VALOR ? PREFIXO_DESC + desc : PREFIXO_PORTA + tela.porta
}

// The same key format, for a saved line.
function chaveEntrada(e) {
  return e.desc !== SEM_VALOR ? PREFIXO_DESC + e.desc : PREFIXO_PORTA + e.porta
}

// The saved line of a screen, or null. A screen with its own desc matches the
// line with that desc. A screen without one (repeated desc) matches the line
// on its port whose desc is "-" or its own desc.
function entradaDaTela(tela, salvo, vivas) {
  var lista = listaOuVazia(salvo)
  var desc = descDoAlvo(tela, vivas)
  for (var i = 0; i < lista.length; i++) {
    var e = lista[i]
    if (e === null || typeof e !== "object") continue
    if (desc !== SEM_VALOR) {
      if (e.desc === desc) return e
    } else if (tela.porta !== SEM_VALOR && e.porta === tela.porta && (e.desc === SEM_VALOR || e.desc === tela.desc)) {
      return e
    }
  }
  return null
}

// Spec 8.2, "Tela conhecida": a line in the TSV or a hand-written desc: rule.
// With a repeated desc only the port counts, so the desc: rule does not.
function conhecida(tela, salvo, regras, vivas) {
  if (entradaDaTela(tela, salvo, vivas) !== null) return true
  var desc = descDoAlvo(tela, vivas)
  return desc !== SEM_VALOR && temRegra(regras, PREFIXO_DESC + desc)
}

// Ruling 14: the availableModes entry (without "Hz") with the same width and
// height and the nearest refresh rate; the first one wins a tie. null when
// the mode is invalid or no entry has that size.
function modoCanonico(modo, modos) {
  var alvo = parseModo(modo)
  if (alvo === null) return null
  var lista = listaOuVazia(modos)
  var melhor = null
  var distancia = 0
  for (var i = 0; i < lista.length; i++) {
    var partes = RE_MODO_DISPONIVEL.exec(String(lista[i]))
    if (partes === null || Number(partes[1]) !== alvo.w || Number(partes[2]) !== alvo.h) continue
    var d = Math.abs(Number(partes[3]) - alvo.hz)
    if (melhor === null || d < distancia) {
      melhor = partes[1] + "x" + partes[2] + "@" + partes[3]
      distancia = d
    }
  }
  return melhor
}

function mesmoModo(a, b, toleranciaHz) {
  var ma = parseModo(a)
  var mb = parseModo(b)
  if (ma === null || mb === null) return false
  return ma.w === mb.w && ma.h === mb.h && Math.abs(ma.hz - mb.hz) <= Number(toleranciaHz) + EPSILON_HZ
}

// Saved mode against the live one, through the screen's own mode list.
function modoDifere(salvo, tela) {
  var a = modoCanonico(salvo, tela.modos)
  var b = modoCanonico(tela.modo, tela.modos)
  if (a !== null && b !== null) return a !== b
  return !mesmoModo(salvo, tela.modo, TOLERANCIA_HZ)
}

// Spec 8.5 and D15: per enabled, movable, unmirrored screen, what differs
// from the saved file. Fields in the order of CAMPOS_DIFERENCA.
var CAMPOS_DIFERENCA = ["modo", "posicao", "transform", "porta", "semLinha"]

function diferencas(vivas, salvo, regras) {
  var lista = listaOuVazia(vivas)
  var saida = []
  for (var i = 0; i < lista.length; i++) {
    var tela = lista[i]
    if (!gravavel(tela, regras)) continue
    var e = entradaDaTela(tela, salvo, vivas)
    var campos = []
    if (e === null) {
      campos.push("semLinha")
    } else {
      if (modoDifere(e.modo, tela)) campos.push("modo")
      if (e.x !== tela.x || e.y !== tela.y) campos.push("posicao")
      if (e.transform !== tela.transform) campos.push("transform")
      if (e.porta !== tela.porta) campos.push("porta")
    }
    if (campos.length > 0) saida.push({ porta: tela.porta, desc: tela.desc, campos: campos })
  }
  return saida
}

function copiarEntrada(e) {
  return { desc: e.desc, porta: e.porta, modo: e.modo, x: e.x, y: e.y, transform: e.transform, visto: e.visto }
}

function entradaDaViva(tela, vivas, hoje) {
  return { desc: descDoAlvo(tela, vivas), porta: tela.porta, modo: tela.modo,
           x: tela.x, y: tela.y, transform: tela.transform, visto: hoje }
}

function compararVisto(a, b) {
  if (a.visto !== b.visto) return a.visto < b.visto ? -1 : 1
  if (a.porta !== b.porta) return a.porta < b.porta ? -1 : 1
  if (a.desc !== b.desc) return a.desc < b.desc ? -1 : 1
  return 0
}

// Joins the written screens with the kept lines: a kept line on a port that
// a written screen now holds gives it up ("-"), a line left with desc and
// port "-" is dropped (Ruling 13), and above CORTE_TSV the kept lines with
// the oldest `visto` go.
function juntarComMantidas(novas, mantidas) {
  var portas = Object.create(null)
  for (var i = 0; i < novas.length; i++) portas[novas[i].porta] = true
  var restantes = []
  for (var j = 0; j < mantidas.length; j++) {
    var e = copiarEntrada(mantidas[j])
    if (e.porta !== SEM_VALOR && portas[e.porta] === true) e.porta = SEM_VALOR
    if (e.desc === SEM_VALOR && e.porta === SEM_VALOR) continue
    restantes.push(e)
  }
  var sobra = novas.length + restantes.length - CORTE_TSV
  if (sobra > 0) {
    restantes.sort(compararVisto)
    restantes = restantes.slice(Math.min(sobra, restantes.length))
  }
  return novas.concat(restantes)
}

// Spec 8.5 and D15, after the confirmation: every writable screen with its
// live values and visto = hoje; every other saved line as it was.
function mesclarArranjo(salvo, vivas, regras, hoje) {
  var lista = listaOuVazia(vivas)
  var anteriores = listaOuVazia(salvo)
  var novas = []
  var usadas = []
  for (var i = 0; i < lista.length; i++) {
    if (!gravavel(lista[i], regras)) continue
    novas.push(entradaDaViva(lista[i], vivas, hoje))
    var e = entradaDaTela(lista[i], anteriores, vivas)
    if (e !== null) usadas.push(e)
  }
  var mantidas = []
  for (var j = 0; j < anteriores.length; j++) {
    var a = anteriores[j]
    if (a !== null && typeof a === "object" && usadas.indexOf(a) < 0) mantidas.push(a)
  }
  return juntarComMantidas(novas, mantidas)
}

// True when an active screen claims this saved line.
function presente(e, vivas) {
  var lista = listaOuVazia(vivas)
  for (var i = 0; i < lista.length; i++) {
    if (ativa(lista[i]) && entradaDaTela(lista[i], [e], vivas) === e) return true
  }
  return false
}

// Spec 8.6 step 6 (S2): drops the line of one absent screen. `chave` uses
// the format of chaveTela.
function esquecer(salvo, chave, vivas) {
  var lista = listaOuVazia(salvo)
  if (chave === PREFIXO_PORTA + SEM_VALOR) return { ok: false, motivo: "ausente" }
  for (var i = 0; i < lista.length; i++) {
    var e = lista[i]
    if (e === null || typeof e !== "object" || chaveEntrada(e) !== chave) continue
    if (presente(e, vivas)) return { ok: false, motivo: "ligada" }
    var entradas = []
    for (var j = 0; j < lista.length; j++) if (j !== i) entradas.push(copiarEntrada(lista[j]))
    return { ok: true, entradas: entradas }
  }
  return { ok: false, motivo: "ausente" }
}

// The port rule paired with a desc: rule: not internal, same mode and
// position strings. The first in code order when there are several.
function portaPar(regra, regras) {
  var pares = []
  for (var nome in regras) {
    if (nome.indexOf(PREFIXO_DESC) === 0 || nome === SEM_VALOR || !validarPorta(nome) || Geo.ehInterna(nome)) continue
    if (regras[nome].modo === regra.modo && regras[nome].posicao === regra.posicao) pares.push(nome)
  }
  pares.sort()
  return pares.length > 0 ? pares[0] : null
}

// A desc: rule as a saved line, or null when its values are not literal
// TSV values or it has no port pair.
function entradaDaRegra(desc, regra, regras, hoje) {
  var pos = RE_POSICAO_REGRA.exec(regra.posicao === null ? "" : regra.posicao)
  if (!validarModo(regra.modo) || pos === null || !posicaoValida(pos[1]) || !posicaoValida(pos[2])) return null
  var porta = portaPar(regra, regras)
  if (porta === null) return null
  return { desc: desc, porta: porta, modo: regra.modo, x: Number(pos[1]) + 0, y: Number(pos[2]) + 0, transform: 0, visto: hoje }
}

function internaNaOrigem(vivas) {
  var lista = listaOuVazia(vivas)
  for (var i = 0; i < lista.length; i++) {
    var t = lista[i]
    if (t === null || typeof t !== "object" || !Geo.ehInterna(t.porta)) continue
    return { porta: t.porta, ok: ativa(t) && t.x === 0 && t.y === 0 }
  }
  return { porta: "", ok: false }
}

// The screen a blocking layout is reported with: the first island, else the
// first external screen of an overlap.
function telaQueBloqueia(v) {
  if (v.ilhas.length > 0) return v.ilhas[0]
  for (var i = 0; i < v.sobreposicoes.length; i++) {
    for (var j = 0; j < v.sobreposicoes[i].length; j++) {
      if (!Geo.ehInterna(v.sobreposicoes[i][j])) return v.sobreposicoes[i][j]
    }
  }
  return v.sobreposicoes.length > 0 ? v.sobreposicoes[0][0] : ""
}

// Spec 8.12: the first file, from the live state. Writable live screens go
// in with live values; a desc: rule no active screen has goes in with the
// rule's mode and position, transform 0 and the paired port ("-" when a live
// screen already holds that port).
function semear(vivas, regras, existe, hoje) {
  var recusa = function (motivo, tela) { return { ok: false, motivo: motivo, tela: tela } }
  if (existe) return recusa("existe", "")
  var interna = internaNaOrigem(vivas)
  if (!interna.ok) return recusa("edp1", interna.porta)
  var lista = listaOuVazia(vivas)
  var ativas = []
  for (var i = 0; i < lista.length; i++) if (ativa(lista[i])) ativas.push(lista[i])
  var v = Geo.validar(ativas, [])
  if (v.bloqueia) return recusa("bloqueia", telaQueBloqueia(v))

  var novas = []
  var descsAtivas = Object.create(null)
  for (var j = 0; j < ativas.length; j++) {
    descsAtivas[ativas[j].desc] = true
    if (gravavel(ativas[j], regras)) novas.push(entradaDaViva(ativas[j], vivas, hoje))
  }
  var daRegra = []
  for (var nome in regras) {
    if (nome.indexOf(PREFIXO_DESC) !== 0) continue
    var desc = nome.substring(PREFIXO_DESC.length)
    if (descsAtivas[desc] === true) continue
    var e = entradaDaRegra(desc, regras[nome], regras, hoje)
    if (e === null) return recusa("semPar", desc)
    daRegra.push(e)
  }
  return { ok: true, entradas: juntarComMantidas(novas, daRegra) }
}

// The scale a ghost is drawn with (Ruling 13): the port rule, else the desc:
// rule, else ESCALA_APROXIMADA marked as approximate.
function escalaDoFantasma(e, regras) {
  var nomes = [e.porta !== SEM_VALOR ? e.porta : null, e.desc !== SEM_VALOR ? PREFIXO_DESC + e.desc : null]
  for (var i = 0; i < nomes.length; i++) {
    if (nomes[i] === null || !temRegra(regras, nomes[i])) continue
    var escala = regras[nomes[i]].escala
    if (typeof escala === "number" && escala > 0) return { escala: escala, aproximada: false }
  }
  return { escala: ESCALA_APROXIMADA, aproximada: true }
}

// Saved lines no active screen claims, drawn with the saved mode (D14).
function fantasmas(salvo, vivas, regras) {
  var lista = listaOuVazia(salvo)
  var saida = []
  for (var i = 0; i < lista.length; i++) {
    var e = lista[i]
    if (e === null || typeof e !== "object" || (e.desc === SEM_VALOR && e.porta === SEM_VALOR)) continue
    if (presente(e, vivas)) continue
    var modo = parseModo(e.modo)
    if (modo === null) continue
    var escala = escalaDoFantasma(e, regras)
    var tamanho = Geo.tamanhoLogico(modo.w, modo.h, escala.escala, e.transform)
    saida.push({ chave: chaveEntrada(e), desc: e.desc, porta: e.porta, modo: e.modo, x: e.x, y: e.y,
                 transform: e.transform, logW: tamanho.logW, logH: tamanho.logH,
                 aproximada: escala.aproximada, visto: e.visto })
  }
  return saida
}

// Read-back after an eval (spec 8.6 step 1.5): every target on an enabled
// screen with the same mode (TOLERANCIA_HZ), position and transform.
function bateu(esperado, telas) {
  var alvos = listaOuVazia(esperado)
  var lista = listaOuVazia(telas)
  for (var i = 0; i < alvos.length; i++) {
    var achou = false
    for (var j = 0; j < lista.length; j++) {
      var t = lista[j]
      if (t === null || typeof t !== "object" || t.porta !== alvos[i].porta || t.ligada === false) continue
      achou = mesmoModo(alvos[i].modo, t.modo, TOLERANCIA_HZ) && t.x === alvos[i].x && t.y === alvos[i].y
              && t.transform === alvos[i].transform
      break
    }
    if (!achou) return false
  }
  return true
}

// Ports whose escala120 differs from the one recorded before the eval.
function escalaMudou(escalasAntes, telas) {
  var lista = listaOuVazia(telas)
  var saida = []
  if (escalasAntes === null || typeof escalasAntes !== "object") return saida
  for (var i = 0; i < lista.length; i++) {
    var t = lista[i]
    if (t === null || typeof t !== "object" || !Object.prototype.hasOwnProperty.call(escalasAntes, t.porta)) continue
    if (escalasAntes[t.porta] !== t.escala120) saida.push(t.porta)
  }
  return saida
}
