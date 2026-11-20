.pragma library
.import "Dados.js" as Dados
.import "Geometria.js" as Geo

// Apply / confirm / revert flow (spec 8.6, Rulings 9 and 15) as a closed
// transition table. transicao() is pure: it never touches its input, and an
// unknown or untimely event returns the very same state with no effects. The
// QML root runs the effects and feeds their outcome back as events.

var CONTAGEM_S = 15            // confirmation countdown, seconds
var GUARDA_S = 30              // revert guard timer, seconds (guarda-reversao.sh owns the real value)
var LEITURA_MS = 3000          // read-back window after an eval
var LEITURA_PASSO_MS = 250     // read-back polling step
var DEBOUNCE_MS = 1500         // screen events settle this long before the reconciler runs
// valor provisório até a Tarefa 1 medir (D18): how long a target port may stay
// removed after a mode/transform eval before the change is reverted (Ruling 9).
var ESPERA_VOLTA_MS = 3000

var TAMANHO_ID = 16
var DIGITOS_HEX = "0123456789abcdef"
var RE_ID = /^[0-9a-f]{16}$/
var SAIDA_OK = "ok"                    // hyprctl eval success, after trim
var EVENTO_REMOVIDA = "monitorremovedv2"
var EVENTO_ADICIONADA = "monitoraddedv2"
var DIALOGO_ESQUECER = "esquecer"
var ORIGEM_MANTER = "manter"
var ORIGEM_ESQUECER = "esquecer"
var SEPARADOR_PORTAS = ", "

var AVISO_SEM_GUARDA = "aviso.semGuarda"
var AVISO_EVAL_FALHOU = "aviso.evalFalhou"
var AVISO_ESCALA_MUDOU = "aviso.escalaMudou"
var AVISO_OUTRA_COISA = "aviso.outraCoisa"
var AVISO_NAO_SALVOU = "aviso.naoSalvou"
var AVISO_RECARREGOU = "aviso.recarregou"
var AVISO_RECARREGADO = "aviso.recarregadoNaConfirmacao"
var AVISO_TELA_MUDOU = "aviso.telaMudou"
var AVISO_REVERTIDO_SEM_TELA = "aviso.revertidoSemTela"
var AVISO_ARQUIVO_INVALIDO = "aviso.naoSalvouArquivoInvalido"
var MOTIVO_ARQUIVO_INVALIDO = "arquivoInvalido"

function estadoInicial() {
  return { nome: "fechado", etapa: "", id: "", ida: "", volta: "", alvo: [], antes: [], portasAlvo: [],
           escalasAntes: {}, restante: 0, dialogo: "", esquecer: "", removidas: {}, ausentes: [] }
}

// 16 lowercase hex digits from a [0, 1) generator; out-of-range draws are clamped.
function novoId(aleatorio) {
  var id = ""
  for (var i = 0; i < TAMANHO_ID; i++) {
    var n = Math.floor(Number(aleatorio()) * DIGITOS_HEX.length)
    if (!(n >= 0)) n = 0
    if (n > DIGITOS_HEX.length - 1) n = DIGITOS_HEX.length - 1
    id += DIGITOS_HEX.charAt(n)
  }
  return id
}

// ---- helpers ----

// The state holds only strings, numbers, booleans, arrays and plain objects.
function copiar(valor) {
  return JSON.parse(JSON.stringify(valor))
}

function tem(mapa, chave) {
  return mapa !== null && typeof mapa === "object" && Object.prototype.hasOwnProperty.call(mapa, chave)
}

function naoVazio(texto) {
  return typeof texto === "string" && texto !== ""
}

function nada(estado) {
  return { estado: estado, efeitos: [] }
}

function avisar(chave, args) {
  return { tipo: "avisar", chave: chave, args: args || [] }
}

// A fresh state with no pending change, under the given name.
function limpo(nome) {
  var estado = estadoInicial()
  estado.nome = nome
  return estado
}

function evalOk(saida) {
  return typeof saida === "string" && saida.trim() === SAIDA_OK
}

// Target ports that dropped out and did not come back yet, in target order.
function portasAusentes(estado) {
  var saida = []
  for (var i = 0; i < estado.portasAlvo.length; i++) {
    if (tem(estado.removidas, estado.portasAlvo[i])) saida.push(estado.portasAlvo[i])
  }
  return saida
}

function semPortas(lista, portas) {
  var saida = []
  for (var i = 0; i < lista.length; i++) if (portas.indexOf(lista[i].porta) < 0) saida.push(lista[i])
  return saida
}

// Ends a revert that left a target port out (I2): the guard goes, no reload.
function terminarSemReload(estado, efeitos, portas) {
  return { estado: limpo("editando"),
           efeitos: efeitos.concat([{ tipo: "desarmarGuarda", id: estado.id },
                                    avisar(AVISO_REVERTIDO_SEM_TELA, [portas.join(SEPARADOR_PORTAS)])]) }
}

// "reverterJa" of the plan: eval the stored volta and wait for its answer.
// A target port that dropped out (unplugged, or switched off by another
// service through a desc: rule, which Hyprland reports as a removal) still
// gets its line back with the values of `antes` (re-review N1): the ida put
// that port's rule last, so restoring it changes nothing for a screen another
// service switched off, and a screen plugged back later never comes back
// with the unconfirmed values. Only the present ports are read back, and a
// port that is away never leads to a reload by itself (I2, emRevertendo).
function reverterJa(estado, aviso) {
  var efeitos = []
  if (estado.nome === "confirmando") efeitos.push({ tipo: "fecharConfirmacao" }, { tipo: "pararContagem" })
  var ausentes = portasAusentes(estado)
  var presentes = semPortas(estado.antes, ausentes)
  efeitos.push({ tipo: "eval", trecho: estado.volta })
  // the notice about the screen that left comes at the end and says more
  if (aviso && !(ausentes.length > 0 && aviso.chave === AVISO_TELA_MUDOU)) efeitos.push(aviso)
  var novo = copiar(estado)
  novo.nome = "revertendo"
  novo.etapa = "avaliando"
  novo.removidas = {}
  novo.antes = copiar(presentes)
  novo.ausentes = ausentes
  return { estado: novo, efeitos: efeitos }
}

// True when every target that did not match the read is in `fora`.
function todasFora(antes, telas, fora) {
  for (var i = 0; i < antes.length; i++) {
    if (fora.indexOf(antes[i].porta) < 0 && !Dados.bateu([antes[i]], telas)) return false
  }
  return true
}

// Target ports missing from a read, or there but switched off.
function portasFora(antes, telas) {
  var saida = []
  if (!Array.isArray(telas)) return saida
  for (var i = 0; i < antes.length; i++) {
    var achou = false
    for (var j = 0; j < telas.length; j++) {
      var t = telas[j]
      if (t !== null && typeof t === "object" && t.porta === antes[i].porta && t.ligada !== false) achou = true
    }
    if (!achou) saida.push(antes[i].porta)
  }
  return saida
}

// Aplicar only starts with both snippets, a target, a valid guard id and the
// caller's word that eDP-1 is at 0x0 on the raw hyprctl data (D4).
function aplicarValido(evento) {
  return evento.edp1NaOrigem === true && typeof evento.id === "string" && RE_ID.test(evento.id)
      && typeof evento.aviso === "string" && naoVazio(evento.ida) && naoVazio(evento.volta)
      && Array.isArray(evento.alvo) && evento.alvo.length > 0
      && Array.isArray(evento.antes) && evento.antes.length > 0
      && evento.escalasAntes !== null && typeof evento.escalasAntes === "object"
}

function portasDe(alvo) {
  var portas = []
  for (var i = 0; i < alvo.length; i++) {
    if (alvo[i] !== null && typeof alvo[i] === "object" && typeof alvo[i].porta === "string") portas.push(alvo[i].porta)
  }
  return portas
}

// Screen events while a change is pending (Ruling 9): target ports may drop
// out and come back; anything else reverts.
function eventoDeTela(estado, evento) {
  if (evento.tipo === "semVolta") {
    if (!tem(estado.removidas, evento.porta)) return nada(estado)
    return reverterJa(estado, avisar(AVISO_TELA_MUDOU))
  }
  if (evento.nome !== EVENTO_REMOVIDA && evento.nome !== EVENTO_ADICIONADA) return nada(estado)
  if (typeof evento.porta !== "string" || estado.portasAlvo.indexOf(evento.porta) < 0) {
    return reverterJa(estado, avisar(AVISO_TELA_MUDOU))
  }
  var novo
  if (evento.nome === EVENTO_REMOVIDA) {
    novo = copiar(estado)
    // defineProperty keeps a port named like an Object.prototype key an own key
    Object.defineProperty(novo.removidas, evento.porta,
                          { value: true, enumerable: true, writable: true, configurable: true })
    return { estado: novo, efeitos: [{ tipo: "esperarVolta", porta: evento.porta, ms: ESPERA_VOLTA_MS }] }
  }
  if (!tem(estado.removidas, evento.porta)) return nada(estado)
  novo = copiar(estado)
  delete novo.removidas[evento.porta]
  return { estado: novo, efeitos: [{ tipo: "cancelarEspera", porta: evento.porta }] }
}

// ---- one handler per state ----

function emFechado(estado, evento) {
  if (evento.tipo !== "abrir") return nada(estado)
  return { estado: limpo(evento.edp1Ligado === true ? "editando" : "somenteLeitura"), efeitos: [] }
}

function emSomenteLeitura(estado, evento) {
  if (evento.tipo === "fechar") return { estado: estadoInicial(), efeitos: [] }
  if (evento.tipo === "edp1" && evento.ligado === true) {
    var novo = copiar(estado)
    novo.nome = "editando"
    return { estado: novo, efeitos: [] }
  }
  return nada(estado)
}

function emEditando(estado, evento) {
  var novo
  switch (evento.tipo) {
  case "fechar":
    return { estado: estadoInicial(), efeitos: [] }
  case "edp1":
    if (evento.ligado !== false) return nada(estado)
    novo = copiar(estado)
    novo.nome = "somenteLeitura"
    return { estado: novo, efeitos: [] }
  case "aplicar":
    if (estado.dialogo !== "" || !aplicarValido(evento)) return nada(estado)
    novo = copiar(estado)
    novo.nome = "aplicando"
    novo.etapa = "armando"
    novo.id = evento.id
    novo.ida = evento.ida
    novo.volta = evento.volta
    novo.alvo = copiar(evento.alvo)
    novo.antes = copiar(evento.antes)
    novo.portasAlvo = portasDe(novo.alvo)
    novo.escalasAntes = copiar(evento.escalasAntes)
    novo.restante = CONTAGEM_S
    novo.removidas = {}
    return { estado: novo, efeitos: [{ tipo: "armarGuarda", id: evento.id, aviso: evento.aviso, volta: evento.volta }] }
  case "esquecerPedido":
    if (estado.dialogo !== "" || !naoVazio(evento.chave)) return nada(estado)
    novo = copiar(estado)
    novo.dialogo = DIALOGO_ESQUECER
    novo.esquecer = evento.chave
    return { estado: novo, efeitos: [{ tipo: "mostrarEsquecer", chave: evento.chave }] }
  case "esquecerCancelado":
    if (estado.dialogo !== DIALOGO_ESQUECER) return nada(estado)
    novo = copiar(estado)
    novo.dialogo = ""
    novo.esquecer = ""
    return { estado: novo, efeitos: [{ tipo: "fecharEsquecer" }] }
  case "esquecerConfirmado":
    if (estado.dialogo !== DIALOGO_ESQUECER) return nada(estado)
    return { estado: limpo("gravando"),
             efeitos: [{ tipo: "fecharEsquecer" }, { tipo: "gravarTsv", origem: ORIGEM_ESQUECER, chave: estado.esquecer }] }
  }
  return nada(estado)
}

function emAplicando(estado, evento) {
  var novo
  if (evento.tipo === "configRecarregada") return reverterJa(estado, avisar(AVISO_RECARREGADO))
  if (evento.tipo === "tela" || evento.tipo === "semVolta") return eventoDeTela(estado, evento)
  if (estado.etapa === "armando" && evento.tipo === "guarda") {
    if (evento.ok !== true) return { estado: limpo("editando"), efeitos: [avisar(AVISO_SEM_GUARDA)] }
    novo = copiar(estado)
    novo.etapa = "avaliando"
    return { estado: novo, efeitos: [{ tipo: "eval", trecho: estado.ida }] }
  }
  if (estado.etapa === "avaliando" && evento.tipo === "evalRespondeu") {
    if (!evalOk(evento.saida)) {
      var saida = typeof evento.saida === "string" ? evento.saida.trim() : ""
      return reverterJa(estado, avisar(AVISO_EVAL_FALHOU, [saida]))
    }
    novo = copiar(estado)
    novo.etapa = "lendo"
    return { estado: novo, efeitos: [{ tipo: "lerDeVolta", esperado: copiar(estado.alvo) }] }
  }
  if (estado.etapa === "lendo" && evento.tipo === "leitura") {
    var mudou = Dados.escalaMudou(estado.escalasAntes, evento.telas)
    if (mudou.length > 0) return reverterJa(estado, avisar(AVISO_ESCALA_MUDOU, [mudou.join(SEPARADOR_PORTAS)]))
    if (!Dados.bateu(estado.alvo, evento.telas)) return nada(estado)
    return paraConfirmacao(estado, [])
  }
  if (estado.etapa === "lendo" && evento.tipo === "leituraEsgotada") {
    var detalhe = typeof evento.detalhe === "string" ? evento.detalhe : ""
    return paraConfirmacao(estado, [avisar(AVISO_OUTRA_COISA, [detalhe])])
  }
  return nada(estado)
}

function paraConfirmacao(estado, extras) {
  var novo = copiar(estado)
  novo.nome = "confirmando"
  novo.etapa = ""
  return { estado: novo, efeitos: [{ tipo: "mostrarConfirmacao" }, { tipo: "iniciarContagem" }].concat(extras) }
}

function emConfirmando(estado, evento) {
  switch (evento.tipo) {
  case "tique":
    if (!(estado.restante > 1)) return reverterJa(estado, null)
    var novo = copiar(estado)
    novo.restante = estado.restante - 1
    return { estado: novo, efeitos: [] }
  case "reverter":
  case "fechar":
    return reverterJa(estado, null)
  case "manter":
    return { estado: limpo("gravando"),
             efeitos: [{ tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }, { tipo: "desarmarGuarda", id: estado.id },
                       { tipo: "gravarTsv", origem: ORIGEM_MANTER, chave: "" }] }
  case "configRecarregada":
    // Hyprland is already back on the saved file (spec 8.6): no eval.
    return { estado: limpo("editando"),
             efeitos: [{ tipo: "fecharConfirmacao" }, { tipo: "pararContagem" }, { tipo: "desarmarGuarda", id: estado.id },
                       avisar(AVISO_RECARREGADO)] }
  case "tela":
  case "semVolta":
    return eventoDeTela(estado, evento)
  }
  return nada(estado)
}

function emGravando(estado, evento) {
  if (evento.tipo !== "gravou") return nada(estado)
  if (evento.ok === true) return { estado: limpo("editando"), efeitos: [] }
  var chave = evento.motivo === MOTIVO_ARQUIVO_INVALIDO ? AVISO_ARQUIVO_INVALIDO : AVISO_NAO_SALVOU
  return { estado: limpo("editando"), efeitos: [avisar(chave)] }
}

// What Manter and Esquecer write (spec 8.3, I3): always a merge over the file
// on disk (`disco` = { existe, texto }). An invalid file is never the base of
// a merge, so the screens only it remembers are never lost: the save is
// refused and the file stays as it is.
function planejarGravacao(origem, chave, disco, vivas, regras, hoje) {
  var base = null
  if (disco !== null && typeof disco === "object" && disco.existe === true) {
    var p = Dados.lerTsv(typeof disco.texto === "string" ? disco.texto : "")
    if (p.ok !== true) return { ok: false, motivo: MOTIVO_ARQUIVO_INVALIDO }
    base = p.entradas
  }
  if (origem === ORIGEM_ESQUECER) {
    var e = Dados.esquecer(base, chave, vivas)
    return e.ok === true ? { ok: true, entradas: e.entradas } : { ok: false, motivo: e.motivo }
  }
  return { ok: true, entradas: Dados.mesclarArranjo(base, vivas, regras, hoje) }
}

// `ausentes` = target ports that were away when the revert started; `antes`
// then holds only the present ones, the ones read back. A refused volta with
// a port away ends without a reload (the failure path of the I2 fix). A
// read-back that runs out reloads when a present, enabled target port did not
// match (spec 8.6.3 item 2, re-review N2); only when every port that did not
// match is away (missing or off in the last read, which leituraEsgotada
// carries as `telas`) does it end without one.
function emRevertendo(estado, evento) {
  var novo
  if (estado.etapa === "avaliando" && evento.tipo === "evalRespondeu") {
    novo = copiar(estado)
    if (!evalOk(evento.saida)) {
      if (estado.ausentes.length > 0) return terminarSemReload(estado, [], estado.ausentes)
      novo.etapa = "recarregando"
      return { estado: novo, efeitos: [{ tipo: "reload" }] }
    }
    if (estado.antes.length === 0) return terminarSemReload(estado, [], estado.ausentes)
    novo.etapa = "lendo"
    return { estado: novo, efeitos: [{ tipo: "lerDeVolta", esperado: copiar(estado.antes) }] }
  }
  if (estado.etapa === "lendo" && evento.tipo === "leitura") {
    if (!Dados.bateu(estado.antes, evento.telas)) return nada(estado)
    if (estado.ausentes.length > 0) return terminarSemReload(estado, [], estado.ausentes)
    return { estado: limpo("editando"), efeitos: [{ tipo: "desarmarGuarda", id: estado.id }] }
  }
  if (estado.etapa === "lendo" && evento.tipo === "leituraEsgotada") {
    var fora = portasFora(estado.antes, evento.telas)
    if (Array.isArray(evento.telas) && todasFora(estado.antes, evento.telas, fora)) {
      return terminarSemReload(estado, [], estado.ausentes.concat(fora))
    }
    novo = copiar(estado)
    novo.etapa = "recarregando"
    return { estado: novo, efeitos: [{ tipo: "reload" }] }
  }
  if (estado.etapa === "recarregando" && evento.tipo === "recarregou") {
    return { estado: limpo("editando"), efeitos: [{ tipo: "desarmarGuarda", id: estado.id }, avisar(AVISO_RECARREGOU)] }
  }
  return nada(estado)
}

var MANIPULADORES = {
  fechado: emFechado,
  somenteLeitura: emSomenteLeitura,
  editando: emEditando,
  aplicando: emAplicando,
  confirmando: emConfirmando,
  gravando: emGravando,
  revertendo: emRevertendo,
}

function transicao(estado, evento) {
  if (estado === null || typeof estado !== "object" || evento === null || typeof evento !== "object") return nada(estado)
  if (typeof estado.nome !== "string" || !Object.prototype.hasOwnProperty.call(MANIPULADORES, estado.nome)) return nada(estado)
  return MANIPULADORES[estado.nome](estado, evento)
}

// ---- Part 2: reconciler and auto-open (spec 8.7, Rulings 8 and 16) ----
// Every function here is pure. `vivas` is every connected screen as
// Geo.lerMonitores reads it (telas plus fora), raw from hyprctl: the
// reconciler only acts with the internal screen at 0x0, where raw and
// normalized are the same. Snippets come from Dados and only merge mode,
// position and transform.

var ESTADOS_SEM_AUTOMACAO = ["aplicando", "confirmando"]   // I14
// Coordinator ruling: the reconciler also stays out of a revert, and out of
// any step name of the Aplicar or revert tables if one is passed.
var ESTADOS_SEM_RECONCILIAR = ["aplicando", "confirmando", "revertendo", "armando", "avaliando", "lendo", "recarregando"]
var GATILHOS_QUE_ABREM = ["monitoraddedv2", "partida"]     // never configreloaded (S3)
var CAMPO_PORTA_EVENTO = 1          // monitoraddedv2 / monitorremovedv2 data: ID,PORTA,DESCRICAO
var SEPARADOR_EVENTO = ","
var SEPARADOR_VAO = ","
var NOTIF_REGRA_CRIADA = "notif.regraCriada"

function listaDe(v) {
  return Array.isArray(v) ? v : []
}

function nomeDoEstado(estado) {
  if (typeof estado === "string") return estado
  if (estado !== null && typeof estado === "object" && typeof estado.nome === "string") return estado.nome
  return ""
}

// I14: true only in a flow state where reconciliar acts (a known state, not
// aplicando, confirmando or revertendo). The root asks before every eval of a
// reconciler sequence, which takes seconds (read-back windows): a false
// aborts the rest of it, with no eval and no memory written, and the next
// screen event (or the end of the change) reconciles again.
function reconciliadorPodeAgir(estado) {
  var nome = nomeDoEstado(estado)
  if (!Object.prototype.hasOwnProperty.call(MANIPULADORES, nome)) return false
  return ESTADOS_SEM_RECONCILIAR.indexOf(nome) < 0
}

// On and not a copy of another screen: part of the arrangement.
function noArranjo(tela) {
  return tela !== null && typeof tela === "object" && tela.ligada !== false && tela.espelho !== true
}

function portaReal(porta) {
  return Dados.validarPorta(porta) && porta !== Dados.SEM_VALOR
}

// D4 and D13 on the raw data: the internal screen is there, enabled and at 0x0.
function internaNaOrigemCrua(vivas) {
  for (var i = 0; i < vivas.length; i++) {
    var t = vivas[i]
    if (t === null || typeof t !== "object" || !Geo.ehInterna(t.porta)) continue
    return noArranjo(t) && t.x === 0 && t.y === 0
  }
  return false
}

// Mode compared through the screen's own list (Dados.modoDifere, Ruling 14).
function valoresDiferem(e, tela) {
  return Dados.modoDifere(e.modo, tela) || e.x !== tela.x || e.y !== tela.y || e.transform !== tela.transform
}

// One snippet, or "" when Dados refuses or there is nothing to send.
function trechoDe(alvos, regras) {
  var r = Dados.montarEval(alvos, regras)
  return r.ok === true && naoVazio(r.trecho) ? r.trecho : ""
}

// Known screen on a port that is not its own in the file (another screen's,
// or "-"): its saved values at this port, and at its desc: rule if it has one.
// Once per arrival (coordinator ruling): skipped when the memory says this
// very screen already got its saved values on this port, even if the live
// values still differ (a port that cannot take them would flicker forever).
function acaoSalva(tela, e, vivas, regras, aplicadas) {
  if (tem(aplicadas, tela.porta) && aplicadas[tela.porta] === tela.desc) return null
  if (e.porta === tela.porta || !valoresDiferem(e, tela)) return null
  var trecho = trechoDe([{ porta: tela.porta, desc: Dados.descDoAlvo(tela, vivas), modo: e.modo,
                           x: e.x, y: e.y, transform: e.transform }], regras)
  var volta = trechoDe([valoresVivos(tela, Dados.SEM_VALOR)], regras)
  if (trecho === "" || volta === "") return null
  return { tipo: "aplicarSalvo", porta: tela.porta, desc: tela.desc, trecho: trecho,
           esperado: [{ porta: tela.porta, modo: e.modo, x: e.x, y: e.y, transform: e.transform }],
           volta: volta, esperadoVolta: [leituraDe(valoresVivos(tela, Dados.SEM_VALOR))] }
}

// A screen's live values as a montarEval target.
function valoresVivos(tela, desc) {
  return { porta: tela.porta, desc: desc, modo: tela.modo, x: tela.x, y: tela.y, transform: tela.transform }
}

// The read-back (Dados.bateu) a montarEval target expects.
function leituraDe(alvo) {
  return { porta: alvo.porta, modo: alvo.modo, x: alvo.x, y: alvo.y, transform: alvo.transform }
}

// Unknown screen on a port with a rule: preferred mode and transform 0, with
// the live values as the way back. Skipped when the memory says this very
// screen was already neutralized there (Ruling 8) or no way back can be built.
function acaoNeutralizar(tela, regras, neutralizadas) {
  if (tem(neutralizadas, tela.porta) && neutralizadas[tela.porta] === tela.desc) return null
  var ida = Dados.montarNeutralizacao(tela.porta, regras)
  if (ida.ok !== true || !naoVazio(ida.trecho)) return null
  var volta = trechoDe([valoresVivos(tela, Dados.SEM_VALOR)], regras)
  if (volta === "") return null
  return { tipo: "neutralizar", porta: tela.porta, desc: tela.desc, trecho: ida.trecho, volta: volta,
           antes: { modo: tela.modo, transform: tela.transform },
           esperadoVolta: [leituraDe(valoresVivos(tela, Dados.SEM_VALOR))] }
}

// Spec 8.7 table. Never writes the file; only fixes the live state when a
// port carries another screen's rule. [] in aplicando, confirmando and
// revertendo (Ruling 16 and the coordinator), with eDP-1 off or absent (D13)
// and with eDP-1 off 0x0 (D4). `neutralizadas` and `aplicadas` are the
// root's memories, port -> desc (Ruling 8 and the coordinator).
function reconciliar(vivas, salvo, regras, neutralizadas, edp1Ligado, estadoNome, aplicadas) {
  var lista = listaDe(vivas)
  if (ESTADOS_SEM_RECONCILIAR.indexOf(nomeDoEstado(estadoNome)) >= 0) return []
  if (edp1Ligado !== true || !internaNaOrigemCrua(lista)) return []
  var acoes = []
  for (var i = 0; i < lista.length; i++) {
    var tela = lista[i]
    if (!noArranjo(tela) || !portaReal(tela.porta) || Geo.ehInterna(tela.porta)) continue
    if (!Dados.temRegra(regras, tela.porta)) continue
    var acao = null
    if (Dados.conhecida(tela, salvo, regras, lista)) {
      var e = Dados.entradaDaTela(tela, salvo, lista)
      if (e !== null) acao = acaoSalva(tela, e, lista, regras, aplicadas)
    } else {
      acao = acaoNeutralizar(tela, regras, neutralizadas)
    }
    if (acao !== null) acoes.push(acao)
  }
  return acoes
}

function telaNaPorta(vivas, porta) {
  for (var i = 0; i < vivas.length; i++) {
    if (vivas[i] !== null && typeof vivas[i] === "object" && vivas[i].porta === porta) return vivas[i]
  }
  return null
}

// Second step of a neutralization, after reading the screens again. An escala120
// that changed anywhere is a failure (D17, I17): the caller runs the action's
// volta. Otherwise the screen goes to the gapless proposal, by port only,
// with the mode it came back with and transform 0, and `esperado` is the
// read that snippet should give. A screen that left (or was switched off)
// meanwhile gives no failure and no snippet.
// I1: Hyprland applies an eval on its next frame, so a read can still show
// the forced values. With `antes` (the action's mode and transform before)
// and the read-back window still open (`esgotou` false), a screen still on
// both gives { esperar: true }: read again. Once the window runs out the
// mode read is taken as the preferred one (it is, when they were equal).
function concluirNeutralizacao(vivasDepois, porta, escalasAntes, regras, antes, esgotou) {
  var falha = { falha: true, trecho: "" }
  var lista = listaDe(vivasDepois)
  if (!portaReal(porta) || Geo.ehInterna(porta)) return falha
  if (!tem(escalasAntes, porta) || Dados.escalaMudou(escalasAntes, lista).length > 0) return falha
  var tela = telaNaPorta(lista, porta)
  if (tela === null || !noArranjo(tela)) return { falha: false, trecho: "" }
  if (esgotou !== true && antes !== null && typeof antes === "object"
      && tela.modo === antes.modo && tela.transform === antes.transform) {
    return { falha: false, trecho: "", esperar: true }
  }
  var ativas = []
  for (var i = 0; i < lista.length; i++) if (noArranjo(lista[i])) ativas.push(lista[i])
  var pos = Geo.propostaParaNova(ativas, porta)
  if (pos === null) return falha
  var alvo = { porta: porta, desc: Dados.SEM_VALOR, modo: tela.modo, x: pos.x, y: pos.y, transform: 0 }
  var trecho = trechoDe([alvo], regras)
  return trecho === "" ? falha : { falha: false, trecho: trecho, esperado: [leituraDe(alvo)] }
}

// After the saved values went to a known screen (spec 8.7 case c): the same
// scale check as a neutralization (D17, I17). A failure means the caller runs
// the action's volta.
function concluirAplicarSalvo(vivasDepois, porta, escalasAntes) {
  var lista = listaDe(vivasDepois)
  var falhou = !tem(escalasAntes, porta) || Dados.escalaMudou(escalasAntes, lista).length > 0
  return { falha: falhou }
}

// S3: an enabled, external screen whose port just got a rule. Only with the
// panel closed and against a known previous rule set.
function notificacoesDeRegra(vivas, regras, regrasAntes, painelAberto) {
  var saida = []
  if (painelAberto === true || regrasAntes === null || typeof regrasAntes !== "object") return saida
  for (var i = 0; i < vivas.length; i++) {
    var t = vivas[i]
    if (!noArranjo(t) || !portaReal(t.porta) || Geo.ehInterna(t.porta)) continue
    if (!Dados.temRegra(regrasAntes, t.porta) && Dados.temRegra(regras, t.porta)) {
      saida.push({ chave: NOTIF_REGRA_CRIADA, args: [t.porta] })
    }
  }
  return saida
}

function podeAbrir(e) {
  return GATILHOS_QUE_ABREM.indexOf(e.gatilho) >= 0 && e.edp1Ligado === true && e.travada === false
         && ESTADOS_SEM_AUTOMACAO.indexOf(nomeDoEstado(e.estado)) < 0
}

// Spec 8.7, "Abertura automática". `oferecidas` and `conhecidasSemArquivo`
// hold Dados.chaveTela keys. The offered list loses the keys of screens no
// longer connected and gains every candidate of an opening that happens; a
// blocked opening (lock, state, trigger) uses nothing up.
function decidirAbertura(entrada) {
  var e = entrada !== null && typeof entrada === "object" ? entrada : {}
  var vivas = listaDe(e.vivas)
  var chavesVivas = []
  for (var i = 0; i < vivas.length; i++) {
    if (vivas[i] !== null && typeof vivas[i] === "object") chavesVivas.push(Dados.chaveTela(vivas[i], vivas))
  }
  var oferecidas = []
  var antes = listaDe(e.oferecidas)
  for (var j = 0; j < antes.length; j++) {
    if (chavesVivas.indexOf(antes[j]) >= 0 && oferecidas.indexOf(antes[j]) < 0) oferecidas.push(antes[j])
  }
  var semArquivo = listaDe(e.conhecidasSemArquivo)
  var candidatas = []
  if (podeAbrir(e)) {
    for (var k = 0; k < vivas.length; k++) {
      var t = vivas[k]
      if (!noArranjo(t) || !portaReal(t.porta) || Geo.ehInterna(t.porta)) continue
      if (Dados.conhecida(t, e.salvo, e.regras, vivas)) continue
      var chave = Dados.chaveTela(t, vivas)
      if (oferecidas.indexOf(chave) >= 0) continue
      if (e.salvo === null && semArquivo.indexOf(chave) >= 0) continue
      candidatas.push({ porta: t.porta, chave: chave })
    }
  }
  for (var c = 0; c < candidatas.length; c++) {
    if (oferecidas.indexOf(candidatas[c].chave) < 0) oferecidas.push(candidatas[c].chave)
  }
  return { abrir: candidatas.length > 0, porta: candidatas.length > 0 ? candidatas[0].porta : "",
           notificacoes: notificacoesDeRegra(vivas, e.regras, e.regrasAntes, e.painelAberto),
           oferecidas: oferecidas }
}

// The port of a monitoraddedv2 / monitorremovedv2 event ("ID,PORTA,DESCRICAO";
// the desc may hold commas), or "" when it is not a valid real port.
function portaDoEvento(dado) {
  if (typeof dado !== "string") return ""
  var campos = dado.split(SEPARADOR_EVENTO, CAMPO_PORTA_EVENTO + 1)
  if (campos.length <= CAMPO_PORTA_EVENTO) return ""
  var porta = campos[CAMPO_PORTA_EVENTO]
  return portaReal(porta) ? porta : ""
}

// One notice per arrangement with a gap: the signature is the sorted list of
// ports in an island or in an overlap between enabled screens. Ghosts never
// count. A clean arrangement resets the signature to "".
function avisoDeVao(vivas, fantasmas, ultimoVao) {
  var lista = listaDe(vivas)
  var ativas = []
  for (var i = 0; i < lista.length; i++) if (noArranjo(lista[i])) ativas.push(lista[i])
  var v = Geo.validar(ativas, listaDe(fantasmas))
  var portas = []
  var juntar = function (p) { if (portas.indexOf(p) < 0) portas.push(p) }
  for (var j = 0; j < v.ilhas.length; j++) juntar(v.ilhas[j])
  for (var k = 0; k < v.sobreposicoes.length; k++) {
    for (var m = 0; m < v.sobreposicoes[k].length; m++) juntar(v.sobreposicoes[k][m])
  }
  portas.sort()
  var assinatura = portas.join(SEPARADOR_VAO)
  return { avisar: assinatura !== "" && assinatura !== ultimoVao, assinatura: assinatura }
}
