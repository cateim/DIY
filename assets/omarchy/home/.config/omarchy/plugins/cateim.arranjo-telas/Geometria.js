.pragma library

// Pure geometry for the display arrangement panel: reading `hyprctl monitors
// all -j`, logical sizes, compatible modes and layout validation. No QML, no
// Hyprland, so node tests load it (tests/geometria.test.mjs). Top-level values
// are `var` so they show up on the module object in QML and in node's vm.

var MIN_CONTATO = 64      // shared edge, in logical px, that counts as "touching"
var LIMIAR_ENCAIXE = 16   // snap distance while dragging, in screen px
var MAX_TELAS = 8         // more enabled screens than this and the panel refuses
var MAX_PASSOS_MDC = 128  // Euclid on doubles ends well before this; hard cap for I10

var PORTA_INTERNA = /^(eDP|LVDS|DSI)-/
var MODO_DISPONIVEL = /^([0-9]+)x([0-9]+)@([0-9]+(?:\.[0-9]+)?)Hz$/

function ehInterna(porta) {
  return PORTA_INTERNA.test(String(porta || ""))
}

function mdc(a, b) {
  for (var i = 0; b && i < MAX_PASSOS_MDC; i++) {
    var resto = a % b
    a = b
    b = resto
  }
  return a
}

// The scale arrives as a float (1.600000023841858), so the math runs in
// 1/120 units, as Omarchy and Hyprland do. Odd transforms swap the sides.
function tamanhoLogico(w, h, escala, transform) {
  var escala120 = Math.round(Number(escala) * 120)
  var largura = w * 120
  var altura = h * 120
  var fracionaria = largura % escala120 !== 0 || altura % escala120 !== 0
  var logW = Math.round(largura / escala120)
  var logH = Math.round(altura / escala120)
  if (Number(transform) % 2 === 1) {
    var troca = logW
    logW = logH
    logH = troca
  }
  return { escala120: escala120, logW: logW, logH: logH, fracionaria: fracionaria }
}

// Parses "WxH@R.RRHz", drops repeats, sorts by area then refresh (largest
// first). A mode is compatible when the scale divides it cleanly (the idea of
// cleanScale in Omarchy's monitor panel); otherwise Hyprland would change the
// scale behind the panel's back.
function modosCompativeis(availableModes, escala) {
  var escala120 = Math.round(Number(escala) * 120)
  var vistos = {}
  var modos = []
  var lista = Array.isArray(availableModes) ? availableModes : []
  for (var i = 0; i < lista.length; i++) {
    var partes = MODO_DISPONIVEL.exec(String(lista[i]))
    if (!partes) continue
    var modo = partes[1] + "x" + partes[2] + "@" + partes[3]
    if (vistos[modo] === true) continue
    vistos[modo] = true
    var w = Number(partes[1])
    var h = Number(partes[2])
    modos.push({ modo: modo, w: w, h: h, hz: Number(partes[3]),
                 compativel: mdc(w * 120, h * 120) % escala120 === 0 })
  }
  modos.sort(function (a, b) {
    return (b.w * b.h - a.w * a.h) || (b.hz - a.hz) || (b.w - a.w) || (a.modo < b.modo ? -1 : 1)
  })
  return modos
}

function lerTela(m, regras) {
  var porta = String(m.name || "")
  var w = Number(m.width)
  var h = Number(m.height)
  var hz = Number(m.refreshRate)
  var transform = Number(m.transform) || 0
  var tamanho = tamanhoLogico(w, h, m.scale, transform)
  var interna = ehInterna(porta)
  var invertida = transform >= 4 && transform <= 7
  var temRegra = regras !== null && typeof regras === "object"
                 && Object.prototype.hasOwnProperty.call(regras, porta)
  var espelho = m.mirrorOf !== undefined && m.mirrorOf !== null
                && String(m.mirrorOf) !== "none" && String(m.mirrorOf) !== ""
  return {
    porta: porta, desc: String(m.description || ""), w: w, h: h, hz: hz,
    modo: w + "x" + h + "@" + hz.toFixed(2), x: Number(m.x), y: Number(m.y),
    transform: transform, escala: Number(m.scale), escala120: tamanho.escala120,
    logW: tamanho.logW, logH: tamanho.logH, fracionaria: tamanho.fracionaria,
    ligada: m.disabled !== true, espelho: espelho, interna: interna, invertida: invertida,
    temRegra: temRegra, movel: !interna && temRegra && !invertida,
    modos: Array.isArray(m.availableModes) ? m.availableModes.slice() : []
  }
}

// `json` is the raw output of `hyprctl monitors all -j`; `regras` maps each
// output with a rule in monitors.lua. Disabled and mirrored screens go to
// `fora` (outside the arrangement).
function lerMonitores(json, regras) {
  var recusa = function (motivo) { return { ok: false, motivo: motivo, telas: [], fora: [] } }
  var lista
  try {
    lista = JSON.parse(String(json))
  } catch (e) {
    return recusa("json")
  }
  if (!Array.isArray(lista)) return recusa("json")
  var telas = []
  var fora = []
  var ligadas = 0
  for (var i = 0; i < lista.length; i++) {
    var m = lista[i]
    if (m === null || typeof m !== "object") return recusa("json")
    var tela = lerTela(m, regras)
    if (tela.ligada) ligadas++
    if (ligadas > MAX_TELAS) return recusa("maxTelas")
    if (tela.ligada && !tela.espelho) telas.push(tela)
    else fora.push(tela)
  }
  return { ok: true, motivo: "", telas: telas, fora: fora }
}

// Moves every screen so the internal one sits at 0x0. Returns copies.
function normalizar(telas) {
  var dx = 0
  var dy = 0
  for (var i = 0; i < telas.length; i++) {
    if (telas[i].interna && telas[i].ligada !== false) {
      dx = telas[i].x
      dy = telas[i].y
      break
    }
  }
  var saida = []
  for (var j = 0; j < telas.length; j++) {
    var copia = Object.assign({}, telas[j])
    copia.x = telas[j].x - dx
    copia.y = telas[j].y - dy
    saida.push(copia)
  }
  return { telas: saida, deslocado: dx !== 0 || dy !== 0 }
}

function retangulo(tela) {
  return { x: tela.x, y: tela.y, w: tela.logW, h: tela.logH }
}

function trechoComum(inicioA, fimA, inicioB, fimB) {
  return Math.max(0, Math.min(fimA, fimB) - Math.max(inicioA, inicioB))
}

// Length of the shared edge, side against side. Touching only at a corner is 0.
function contato(a, b) {
  var ra = retangulo(a)
  var rb = retangulo(b)
  if (ra.x + ra.w === rb.x || rb.x + rb.w === ra.x)
    return trechoComum(ra.y, ra.y + ra.h, rb.y, rb.y + rb.h)
  if (ra.y + ra.h === rb.y || rb.y + rb.h === ra.y)
    return trechoComum(ra.x, ra.x + ra.w, rb.x, rb.x + rb.w)
  return 0
}

function sobrepoe(a, b) {
  var ra = retangulo(a)
  var rb = retangulo(b)
  return trechoComum(ra.x, ra.x + ra.w, rb.x, rb.x + rb.w) > 0
         && trechoComum(ra.y, ra.y + ra.h, rb.y, rb.y + rb.h) > 0
}

// Overlaps count between every enabled screen; islands only for movable ones
// (a screen with no rule or with transform 4 to 7 is a fixed obstacle).
// The contact graph has every enabled screen as a node, rooted at the
// internal one; with no internal screen there is no root and no island.
function validar(telas, fantasmas) {
  var ligadas = []
  for (var i = 0; i < telas.length; i++)
    if (telas[i].ligada !== false && !telas[i].espelho) ligadas.push(telas[i])

  var sobreposicoes = []
  var estreitos = []
  var vizinhos = []
  for (var a = 0; a < ligadas.length; a++) vizinhos.push([])
  for (a = 0; a < ligadas.length; a++) {
    for (var b = a + 1; b < ligadas.length; b++) {
      if (sobrepoe(ligadas[a], ligadas[b])) sobreposicoes.push([ligadas[a].porta, ligadas[b].porta])
      var c = contato(ligadas[a], ligadas[b])
      if (c >= MIN_CONTATO) {
        vizinhos[a].push(b)
        vizinhos[b].push(a)
      } else if (c > 0) {
        estreitos.push([ligadas[a].porta, ligadas[b].porta])
      }
    }
  }

  var ilhas = []
  var raiz = -1
  for (a = 0; a < ligadas.length; a++) if (ligadas[a].interna) { raiz = a; break }
  if (raiz >= 0) {
    var alcancada = []
    for (a = 0; a < ligadas.length; a++) alcancada.push(false)
    alcancada[raiz] = true
    var fila = [raiz]
    for (var k = 0; k < fila.length; k++) {
      var atual = vizinhos[fila[k]]
      for (var v = 0; v < atual.length; v++) {
        if (alcancada[atual[v]]) continue
        alcancada[atual[v]] = true
        fila.push(atual[v])
      }
    }
    for (a = 0; a < ligadas.length; a++)
      if (ligadas[a].movel && !alcancada[a]) ilhas.push(ligadas[a].porta)
  }

  var sobreFantasma = []
  var lista = Array.isArray(fantasmas) ? fantasmas : []
  for (a = 0; a < ligadas.length; a++)
    for (var f = 0; f < lista.length; f++)
      if (sobrepoe(ligadas[a], lista[f])) sobreFantasma.push([ligadas[a].porta, lista[f].chave])

  return { sobreposicoes: sobreposicoes, ilhas: ilhas, estreitos: estreitos,
           sobreFantasma: sobreFantasma, bloqueia: sobreposicoes.length > 0 || ilhas.length > 0 }
}

// ---- Snapping and correction (spec 8.5, "Encaixe e correção") ----
// Every function here returns new objects and never changes its input.
// Positions come out as integers; distances are squared, also integers.

function ativa(tela) {
  return tela.ligada !== false && !tela.espelho
}

function prender(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo)
}

function copiar(telas) {
  var saida = []
  for (var i = 0; i < telas.length; i++) saida.push(Object.assign({}, telas[i]))
  return saida
}

function indicePorta(telas, porta) {
  for (var i = 0; i < telas.length; i++) if (telas[i].porta === porta) return i
  return -1
}

function ponto(pos) {
  return { x: Math.round(Number(pos.x)), y: Math.round(Number(pos.y)) }
}

// While dragging: x goes to the nearest matching edge of another enabled
// screen (left to right, right to left, left to left, right to right) when it
// is closer than `limiar`; y the same way. Disabled entries and the screen
// itself never attract; the caller passes no ghosts.
function encaixar(tela, outras, pos, limiar) {
  var p = ponto(pos)
  var saida = { x: p.x, y: p.y }
  var distX = limiar
  var distY = limiar
  var lista = Array.isArray(outras) ? outras : []
  for (var i = 0; i < lista.length; i++) {
    var o = lista[i]
    if (!ativa(o) || o.porta === tela.porta) continue
    var r = retangulo(o)
    var xs = [r.x + r.w, r.x - tela.logW, r.x, r.x + r.w - tela.logW]
    var ys = [r.y + r.h, r.y - tela.logH, r.y, r.y + r.h - tela.logH]
    for (var k = 0; k < 4; k++) {
      var dx = Math.abs(xs[k] - p.x)
      if (dx < distX) { distX = dx; saida.x = xs[k] }
      var dy = Math.abs(ys[k] - p.y)
      if (dy < distY) { distY = dy; saida.y = ys[k] }
    }
  }
  return saida
}

// The four spots next to `f`, in tie order right, below, left, above. The
// perpendicular coordinate is clamped so the shared edge is >= MIN_CONTATO.
function candidatos(f, tela, p) {
  var r = retangulo(f)
  var y = prender(p.y, r.y - tela.logH + MIN_CONTATO, r.y + r.h - MIN_CONTATO)
  var x = prender(p.x, r.x - tela.logW + MIN_CONTATO, r.x + r.w - MIN_CONTATO)
  return [{ x: r.x + r.w, y: y }, { x: x, y: r.y + r.h },
          { x: r.x - tela.logW, y: y }, { x: x, y: r.y - tela.logH }]
}

function livre(tela, lugar, obstaculos) {
  var t = { x: lugar.x, y: lugar.y, logW: tela.logW, logH: tela.logH }
  for (var i = 0; i < obstaculos.length; i++) if (sobrepoe(t, obstaculos[i])) return false
  return true
}

// Nearest spot to `desejada` that touches one of `ancoras` and overlaps none
// of `obstaculos`. Ties keep the first: lowest anchor index, then side order.
// Returns null only when every candidate is blocked.
function maisPerto(ancoras, obstaculos, tela, desejada) {
  var p = ponto(desejada)
  var melhor = null
  var melhorDist = 0
  for (var i = 0; i < ancoras.length; i++) {
    var lista = candidatos(ancoras[i], tela, p)
    for (var k = 0; k < lista.length; k++) {
      if (!livre(tela, lista[k], obstaculos)) continue
      var dx = lista[k].x - p.x
      var dy = lista[k].y - p.y
      var dist = dx * dx + dy * dy
      if (melhor === null || dist < melhorDist) {
        melhor = lista[k]
        melhorDist = dist
      }
    }
  }
  return melhor === null ? null : { x: melhor.x, y: melhor.y, dist: melhorDist }
}

// Total: right of the fixed screen reaching furthest right nothing overlaps.
// With no fixed screen at all, the wanted spot is returned as is.
function posicionarJunto(fixas, tela, desejada) {
  var lista = []
  var entrada = Array.isArray(fixas) ? fixas : []
  for (var i = 0; i < entrada.length; i++)
    if (ativa(entrada[i]) && entrada[i].porta !== tela.porta) lista.push(entrada[i])
  var melhor = maisPerto(lista, lista, tela, desejada)
  if (melhor === null) return ponto(desejada)
  return { x: melhor.x, y: melhor.y }
}

function tocaAlguma(tela, outras) {
  for (var i = 0; i < outras.length; i++) if (contato(tela, outras[i]) >= MIN_CONTATO) return true
  return false
}

// Breadth-first walk over the placed screens, from `raizes`, through edges
// of at least MIN_CONTATO. Returns a map index -> true.
function alcancar(telas, colocada, raizes) {
  var alcancada = {}
  var fila = []
  for (var r = 0; r < raizes.length; r++) {
    alcancada[raizes[r]] = true
    fila.push(raizes[r])
  }
  for (var k = 0; k < fila.length; k++) {
    for (var j = 0; j < telas.length; j++) {
      if (colocada[j] !== true || alcancada[j] === true) continue
      if (contato(telas[fila[k]], telas[j]) < MIN_CONTATO) continue
      alcancada[j] = true
      fila.push(j)
    }
  }
  return alcancada
}

function selecionar(telas, mapa) {
  var saida = []
  for (var i = 0; i < telas.length; i++) if (mapa[i] === true) saida.push(telas[i])
  return saida
}

// Fixed from the start: internal screens and every non-movable one (no rule,
// transform 4 to 7), never moved. `fixasIniciais` (ports) are movable screens
// to keep in place: one that overlaps a placed screen, or that ends up out of
// the internal screen's component, loses that and is moved like the rest.
// Each round joins, one at a time and by index, the pending screens that
// touch the component and overlap no placed screen; then moves the pending
// screen closest to the component next to it. At most telas.length rounds.
function corrigir(telas, fixasIniciais) {
  var saida = copiar(telas)
  var preferidas = Array.isArray(fixasIniciais) ? fixasIniciais : []
  var ligadas = []
  var colocada = {}
  for (var i = 0; i < saida.length; i++) {
    if (!ativa(saida[i])) continue
    ligadas.push(i)
    if (saida[i].interna || !saida[i].movel) colocada[i] = true
  }
  for (var a = 0; a < ligadas.length; a++) {
    var p = ligadas[a]
    if (colocada[p] === true || preferidas.indexOf(saida[p].porta) < 0) continue
    if (livre(saida[p], saida[p], selecionar(saida, colocada))) colocada[p] = true
  }

  var raizes = []
  for (a = 0; a < ligadas.length; a++) if (saida[ligadas[a]].interna) raizes.push(ligadas[a])
  if (raizes.length === 0)
    for (a = 0; a < ligadas.length; a++) if (colocada[ligadas[a]] === true) raizes.push(ligadas[a])
  if (raizes.length === 0 && ligadas.length > 0) {
    raizes.push(ligadas[0])
    colocada[ligadas[0]] = true
  }
  if (raizes.length === 0) return saida

  for (var volta = 0; volta < saida.length; volta++) {
    var alcancada = alcancar(saida, colocada, raizes)
    for (var passo = 0; passo < ligadas.length; passo++) {
      var junta = -1
      var ancoras = selecionar(saida, alcancada)
      var obstaculos = selecionar(saida, colocada)
      for (a = 0; a < ligadas.length; a++) {
        var c = ligadas[a]
        if (colocada[c] === true) continue
        if (tocaAlguma(saida[c], ancoras) && livre(saida[c], saida[c], obstaculos)) { junta = c; break }
      }
      if (junta < 0) break
      colocada[junta] = true
      alcancada = alcancar(saida, colocada, raizes)
    }

    for (a = 0; a < ligadas.length; a++) {
      var f = ligadas[a]
      if (colocada[f] === true && saida[f].movel && !saida[f].interna && alcancada[f] !== true)
        delete colocada[f]
    }

    ancoras = selecionar(saida, alcancada)
    obstaculos = selecionar(saida, colocada)
    var escolhida = -1
    var lugar = null
    for (a = 0; a < ligadas.length; a++) {
      var t = ligadas[a]
      if (colocada[t] === true) continue
      var opcao = maisPerto(ancoras, obstaculos, saida[t], saida[t])
      if (opcao === null) opcao = maisPerto(obstaculos, obstaculos, saida[t], saida[t])
      if (opcao === null) continue
      if (lugar === null || opcao.dist < lugar.dist) {
        escolhida = t
        lugar = opcao
      }
    }
    if (escolhida < 0) break
    saida[escolhida].x = lugar.x
    saida[escolhida].y = lugar.y
    colocada[escolhida] = true
  }
  return saida
}

function outrasLigadas(telas, indice) {
  var saida = []
  for (var i = 0; i < telas.length; i++) if (i !== indice && ativa(telas[i])) saida.push(telas[i])
  return saida
}

// Drop after a drag. A drop that touches another enabled screen and overlaps
// none stays; otherwise it goes to the nearest valid spot. Then `corrigir`
// rejoins whatever the move left loose. Non-movable screens never move.
function soltar(telas, porta, pos) {
  var saida = copiar(telas)
  var i = indicePorta(saida, porta)
  if (i < 0 || !ativa(saida[i]) || !saida[i].movel) return saida
  var tela = saida[i]
  var outras = outrasLigadas(saida, i)
  var p = ponto(pos)
  tela.x = p.x
  tela.y = p.y
  if (!tocaAlguma(tela, outras) || !livre(tela, tela, outras)) {
    var lugar = posicionarJunto(outras, tela, p)
    tela.x = lugar.x
    tela.y = lugar.y
  }
  return corrigir(saida, [porta])
}

// New mode or orientation of an external screen. It stays on the same side
// of the neighbour it shared the longest edge with: on its right or below it
// keeps x or y; on its left or above it the far edge follows the neighbour.
function redimensionar(telas, porta, modo, transform) {
  var saida = copiar(telas)
  var recusa = function (motivo) { return { ok: false, motivo: motivo, telas: saida } }
  var i = indicePorta(saida, porta)
  if (i < 0 || !ativa(saida[i])) return recusa("porta")
  var tela = saida[i]
  if (tela.interna) return recusa("interna")
  if (!tela.movel) return recusa("fixa")
  var tr = Number(transform)
  if (!(tr === 0 || tr === 1 || tr === 2 || tr === 3)) return recusa("transform")
  var w = Number(modo && modo.w)
  var h = Number(modo && modo.h)
  var hz = Number(modo && modo.hz)
  if (!(Number.isInteger(w) && w > 0 && Number.isInteger(h) && h > 0 && hz > 0)) return recusa("modo")

  var escala = tela.escala120 > 0 ? tela.escala120 / 120 : (Number(tela.escala) > 0 ? Number(tela.escala) : 1)
  var tamanho = tamanhoLogico(w, h, escala, tr)

  var vizinha = null
  var maior = 0
  for (var j = 0; j < saida.length; j++) {
    if (j === i || !ativa(saida[j])) continue
    var c = contato(tela, saida[j])
    if (c > maior) { maior = c; vizinha = saida[j] }
  }
  var x = tela.x
  var y = tela.y
  if (vizinha !== null) {
    var v = retangulo(vizinha)
    var velho = retangulo(tela)
    if (velho.x === v.x + v.w) x = velho.x
    else if (velho.x + velho.w === v.x) x = v.x - tamanho.logW
    else if (velho.y === v.y + v.h) y = velho.y
    else if (velho.y + velho.h === v.y) y = v.y - tamanho.logH
  }

  tela.w = w
  tela.h = h
  tela.hz = hz
  tela.modo = w + "x" + h + "@" + hz.toFixed(2)
  tela.transform = tr
  tela.escala120 = tamanho.escala120
  tela.logW = tamanho.logW
  tela.logH = tamanho.logH
  tela.fracionaria = tamanho.fracionaria
  tela.x = x
  tela.y = y
  return { ok: true, motivo: "", telas: corrigir(saida, [porta]) }
}

// Where a newly seen screen should go: the nearest valid spot next to the
// other enabled screens, from where Hyprland put it. Ghosts are not passed.
// Unknown port: null.
function propostaParaNova(telas, porta) {
  var i = indicePorta(telas, porta)
  if (i < 0) return null
  return posicionarJunto(outrasLigadas(telas, i), telas[i], { x: telas[i].x, y: telas[i].y })
}
