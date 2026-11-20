import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import "Geometria.js" as Geo
import "Dados.js" as Dados
import "Fluxo.js" as Fluxo

// Display arrangement panel, root (plan task 11; the windows are task 12). It reads the
// screens (`hyprctl monitors all -j`), the rules in monitors.lua and the saved
// arrangement (monitors-arranjo.tsv); listens to monitoraddedv2,
// monitorremovedv2 and configreloaded; runs the effects of Fluxo.transicao
// (eval, read-back, revert guard, reload, countdown, file writes); reconciles
// the live state after screen events; and answers the shell IPC. The pure
// model lives in Geometria.js, Dados.js and Fluxo.js. Every process gets an
// argument list, never `bash -c` with a dynamic value (I9).
Item {
  id: root

  readonly property string logTag: "[cateim.arranjo-telas]"
  readonly property string pastaPlugin: decodeURIComponent(String(Qt.resolvedUrl("."))
                                         .replace(/^[a-z]+:\/\//, "")).replace(/\/+$/, "")
  readonly property string scriptGuarda: pastaPlugin + "/guarda-reversao.sh"
  readonly property string caminhoMonitors: Quickshell.env("HOME") + "/.config/hypr/monitors.lua"
  readonly property string caminhoTsv: Quickshell.env("HOME") + "/.config/hypr/monitors-arranjo.tsv"
  readonly property string tempoIpc: "15s"            // OMARCHY_SHELL_IPC_TIMEOUT for calls back into the shell
  readonly property int contagemPassoMs: 1000         // one countdown tick
  // A process still running after this is killed and counts as failed, so a
  // hung hyprctl or systemd-run never holds the flow (above the 15 s IPC timeout).
  readonly property int limiteProcessoMs: 20000
  readonly property string saidaDestravada: "false"   // `omarchy-shell lock isLocked`; anything else counts as locked
  // States where a change is in flight; screen events wait for them (spec 8.6).
  readonly property var estadosOcupados: ["aplicando", "confirmando", "revertendo", "gravando"]
  readonly property var estadosComTransicao: ["aplicando", "confirmando"]
  readonly property var eventosDeTela: ["monitoraddedv2", "monitorremovedv2", "configreloaded"]
  // Debounce triggers, weakest first: the strongest one seen in a burst wins.
  readonly property var prioridadeGatilho: ["", "monitorsLua", "monitorremovedv2", "configreloaded", "monitoraddedv2", "partida"]

  // Screen px per logical px in the drawing (Task 12 sets it); the snap
  // threshold of arrastar is Geo.LIMIAR_ENCAIXE screen px.
  property real escalaDesenho: 1

  // ---- Read-only view for the interface (Task 12) ----
  readonly property string estado: priv.fluxo.nome
  readonly property bool opened: priv.fluxo.nome !== "fechado"
  readonly property var leitura: priv.leitura
  readonly property bool edp1Ligado: root.internaLigada(priv.leitura)
  readonly property bool edp1NaOrigem: root.internaNaOrigem(priv.leitura)
  readonly property var vivas: priv.leitura ? priv.leitura.vivas : []
  readonly property var telas: priv.leitura ? priv.leitura.telas : []
  readonly property var fora: priv.leitura ? priv.leitura.fora : []
  readonly property var regras: priv.regras
  readonly property var salvo: priv.salvo
  // The saved lines the model works with: null without a file, and also with
  // an invalid one, which the loader ignores too.
  readonly property var salvoEntradas: priv.salvo.existe && priv.salvo.ok ? priv.salvo.entradas : null
  readonly property var fantasmas: Dados.fantasmas(root.salvoEntradas, root.vivas, priv.regras)
  readonly property var edicoes: priv.edicoes
  readonly property var alvo: root.aplicarEdicoes(root.telas, priv.edicoes)
  readonly property var diferencasAtuais: Dados.diferencas(root.alvo.concat(root.fora), root.salvoEntradas, priv.regras)
  readonly property var validacao: Geo.validar(root.alvo, root.fantasmas)
  readonly property var semRegra: root.portasSemRegra(root.telas, priv.regras)
  readonly property string selecionada: priv.selecionada
  readonly property var arrasto: priv.arrasto
  readonly property var faixa: root.calcularFaixa(priv.leitura, root.edp1Ligado, root.edp1NaOrigem, priv.salvo,
                                                  root.semRegra, root.validacao, priv.avisoAtual, priv.telaNova,
                                                  root.alvo, root.salvoEntradas, priv.regras, root.fantasmas)
  readonly property string motivoAplicar: root.calcularMotivoAplicar(priv.fluxo, priv.leitura, root.edp1NaOrigem,
                                                                     root.validacao, root.diferencasAtuais)
  readonly property bool aplicarHabilitado: priv.fluxo.nome === "editando" && priv.fluxo.dialogo === ""
                                            && root.motivoAplicar === ""
  readonly property int segundosRestantes: priv.fluxo.restante
  readonly property bool confirmacaoVisivel: priv.confirmacaoVisivel
  readonly property string dialogoEsquecer: priv.fluxo.dialogo === "esquecer" ? priv.fluxo.esquecer : ""

  // Writable state. Objects and arrays here are always replaced, never
  // changed in place, so every binding above sees the change.
  QtObject {
    id: priv

    property var fluxo: Fluxo.estadoInicial()
    // { ok, motivo, cruas, vivas, telas, fora }: cruas as hyprctl says,
    // vivas = cruas after Geo.normalizar, split into telas (on) and fora.
    property var leitura: null
    property var regras: Dados.regrasDoMonitorsLua("")
    property var salvo: ({ existe: false, ok: false, entradas: [], linha: 0, motivo: "" })
    property bool tsvFalhou: true
    property var edicoes: ({})
    property var arrasto: null
    property string selecionada: ""
    property var avisoAtual: null
    property string telaNova: ""
    property bool confirmacaoVisivel: false
    property bool fecharPendente: false

    // Reconciler memories (Ruling 8 and the coordinator), port -> desc.
    property var neutralizadas: ({})
    property var aplicadas: ({})
    property var oferecidas: []
    property var conhecidasSemArquivo: []
    property var regrasAntes: null
    property string ultimoVao: ""

    property string gatilho: ""
    property bool limparMemorias: false
    property bool eventoNoMeio: false
    property bool reconciliando: false
    property bool reconciliarDeNovo: false

    property var filaGuarda: []
    property bool guardaRodando: false
    property var esperas: ({})
    property int lendoDecorrido: 0
    property var esperadoLeitura: []
    property var ultimaLeituraVolta: null
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Handed to the windows under another name: inside them `strings: strings`
  // would bind their own property to itself.
  readonly property var traducoes: strings

  // The two windows (Task 12). Both stay on eDP-1, which is never a target.
  PainelArranjo {
    id: painelArranjo
    arranjo: root
    strings: root.traducoes
  }

  JanelaConfirmacao {
    arranjo: root
    strings: root.traducoes
    painel: painelArranjo
  }

  // ---- Shell host contract (spec 8.12) ----

  function open(payloadJson) {
    var pedido = {}
    try { pedido = JSON.parse(payloadJson || "{}") || {} } catch (e) { pedido = {} }
    root.atualizarSalvo()
    if (priv.fluxo.nome === "fechado") root.enviar({ tipo: "abrir", edp1Ligado: root.edp1Ligado })
    if (pedido && typeof pedido.porta === "string") root.selecionar(pedido.porta)
    root.lerAgora(null)
    return priv.fluxo.nome
  }

  // Outside fechado/editando/somenteLeitura the model ignores `fechar` or
  // turns it into a revert; the panel then closes once the change settles.
  function close() {
    if (priv.fluxo.nome === "fechado") return "fechado"
    root.enviar({ tipo: "fechar" })
    if (priv.fluxo.nome !== "fechado") priv.fecharPendente = true
    return priv.fluxo.nome
  }

  function toggle() {
    if (root.opened) return root.close()
    return root.open("{}")
  }

  // What the panel sees, as JSON, for the tests:
  //   omarchy-shell shell call cateim.arranjo-telas state ""
  function state() {
    var regras = priv.regras
    var tela = function (t) {
      return { porta: t.porta, desc: t.desc, modo: t.modo, x: t.x, y: t.y, transform: t.transform,
               escala: t.escala, logW: t.logW, logH: t.logH, temRegra: Dados.temRegra(regras, t.porta),
               interna: t.interna, invertida: t.invertida }
    }
    return JSON.stringify({
      estado: priv.fluxo.nome,
      etapa: priv.fluxo.etapa,
      edp1Ligado: root.edp1Ligado,
      edp1NaOrigem: root.edp1NaOrigem,
      leitura: priv.leitura ? { ok: priv.leitura.ok, motivo: priv.leitura.motivo } : null,
      telas: root.telas.map(tela),
      fora: root.fora.map(tela),
      alvo: root.alvo.map(tela),
      fantasmas: root.fantasmas,
      diferencas: root.diferencasAtuais,
      validacao: root.validacao,
      semRegra: root.semRegra,
      arquivo: { existe: priv.salvo.existe, valido: priv.salvo.existe && priv.salvo.ok,
                 linha: priv.salvo.linha, motivo: priv.salvo.motivo },
      aplicarHabilitado: root.aplicarHabilitado,
      motivoAplicar: root.motivoAplicar,
      faixa: root.faixa,
      selecionada: priv.selecionada,
      edicoes: priv.edicoes,
      segundosRestantes: priv.fluxo.restante,
      confirmacaoVisivel: priv.confirmacaoVisivel,
      dialogoEsquecer: root.dialogoEsquecer,
      oferecidas: priv.oferecidas,
      neutralizadas: priv.neutralizadas,
      aplicadas: priv.aplicadas
    })
  }

  // First saved file from the live state (spec 8.12, I11). Uses the last
  // completed screen read; changes nothing live and never reloads Hyprland.
  // "ok" or "recusado: <motivo> <tela>".
  function semear() {
    var r = priv.leitura
    if (r === null || !r.ok) return "recusado: leitura"
    root.lerRegrasAgora()
    var disco = root.lerTsvAgora()
    var s = Dados.semear(r.cruas, priv.regras, disco.existe, root.hoje())
    if (!s.ok) return "recusado: " + s.motivo + (s.tela ? " " + s.tela : "")
    var w = root.escreverArquivo(s.entradas)
    if (!w.ok) return "recusado: " + w.motivo
    console.info(root.logTag, "seeded the saved arrangement,", s.entradas.length, "lines")
    return "ok"
  }

  // ---- Interface actions ----

  function selecionar(chave) {
    priv.selecionada = String(chave || "")
  }

  function podeEditar() {
    return priv.fluxo.nome === "editando" && priv.fluxo.dialogo === ""
  }

  // While dragging: snap only, shown live in the drawing through `arrasto`.
  function arrastar(porta, x, y) {
    if (!root.podeEditar()) return
    var lista = root.alvo
    var tela = root.telaDaPorta(lista, porta)
    if (tela === null || !tela.movel) return
    var outras = []
    for (var i = 0; i < lista.length; i++) if (lista[i].porta !== porta) outras.push(lista[i])
    var limiar = Geo.LIMIAR_ENCAIXE / (root.escalaDesenho > 0 ? root.escalaDesenho : 1)
    var pos = Geo.encaixar(tela, outras, { x: Number(x), y: Number(y) }, limiar)
    priv.arrasto = { porta: porta, x: pos.x, y: pos.y }
  }

  function soltarTela(porta, x, y) {
    priv.arrasto = null
    if (!root.podeEditar()) return
    root.usarNovas(Geo.soltar(root.alvo, String(porta), { x: Number(x), y: Number(y) }))
  }

  function trocarModo(porta, modo) {
    if (!root.podeEditar()) return
    var tela = root.telaDaPorta(root.alvo, porta)
    if (tela === null) return
    var escolhido = null
    var modos = Geo.modosCompativeis(tela.modos, tela.escala)
    for (var i = 0; i < modos.length; i++) {
      if (modos[i].modo === String(modo) && modos[i].compativel) { escolhido = modos[i]; break }
    }
    if (escolhido === null) {
      console.warn(root.logTag, "mode refused for", porta)
      // The menu snaps back; the band says why (spec 8.10).
      var partes = /^([0-9]+)x([0-9]+)/.exec(String(modo))
      priv.avisoAtual = { chave: "modo.recusado",
                          args: [partes !== null ? partes[1] + " x " + partes[2] : String(modo),
                                 Commons.I18n.formatNumber(tela.escala)] }
      return
    }
    var r = Geo.redimensionar(root.alvo, porta, { w: escolhido.w, h: escolhido.h, hz: escolhido.hz }, tela.transform)
    if (r.ok) root.usarNovas(r.telas)
    else root.recusouRedimensionar(porta, r.motivo)
  }

  function trocarOrientacao(porta, t) {
    if (!root.podeEditar()) return
    var tela = root.telaDaPorta(root.alvo, porta)
    if (tela === null) return
    var r = Geo.redimensionar(root.alvo, porta, { w: tela.w, h: tela.h, hz: tela.hz }, Number(t))
    if (r.ok) root.usarNovas(r.telas)
    else root.recusouRedimensionar(porta, r.motivo)
  }

  // Geo.redimensionar refusal (porta|fixa|transform|modo|interna) as a band.
  function recusouRedimensionar(porta, motivo) {
    console.warn(root.logTag, "resize refused for", porta, motivo)
    priv.avisoAtual = { chave: "redimensionar." + motivo, args: [String(porta)] }
  }

  function corrigirArranjo() {
    if (!root.podeEditar()) return
    root.usarNovas(Geo.corrigir(root.alvo, []))
  }

  function desfazer() {
    priv.edicoes = ({})
    priv.arrasto = null
    priv.avisoAtual = null
  }

  // S4: focus a screen on a port without a rule, so the Display panel opens on it.
  function focarTela(porta) {
    var p = String(porta || "")
    if (!Dados.validarPorta(p) || p === Dados.SEM_VALOR) return "recusado"
    root.executar(["hyprctl", "dispatch", 'hl.dsp.focus({ monitor = "' + p + '" })'], null, null)
    return "ok"
  }

  // Ruling 12: also reachable through `omarchy-shell shell call`.
  function aplicar() {
    if (!root.aplicarHabilitado) return "recusado: " + root.motivoAplicar
    priv.avisoAtual = null
    root.lerAgora(function (r) { root.montarAplicar(r) })
    return "ok"
  }

  function manter() {
    root.enviar({ tipo: "manter" })
    return priv.fluxo.nome
  }

  function reverter() {
    root.enviar({ tipo: "reverter" })
    return priv.fluxo.nome
  }

  function pedirEsquecer(chave) {
    var k = String(chave || "")
    var achou = false
    var lista = root.fantasmas
    for (var i = 0; i < lista.length; i++) if (lista[i].chave === k) achou = true
    if (!achou) return "recusado"
    root.enviar({ tipo: "esquecerPedido", chave: k })
    return priv.fluxo.dialogo === "esquecer" ? "ok" : "recusado"
  }

  function cancelarEsquecer() {
    root.enviar({ tipo: "esquecerCancelado" })
    return priv.fluxo.nome
  }

  function confirmarEsquecer() {
    root.enviar({ tipo: "esquecerConfirmado" })
    return priv.fluxo.nome
  }

  // {"porta", "x", "y"} | {"porta", "modo"} | {"porta", "transform"}; returns state().
  function editar(json) {
    var p = null
    try { p = JSON.parse(String(json)) } catch (e) { p = null }
    if (p !== null && typeof p === "object" && typeof p.porta === "string") {
      if (p.modo !== undefined) root.trocarModo(p.porta, p.modo)
      else if (p.transform !== undefined) root.trocarOrientacao(p.porta, p.transform)
      else if (p.x !== undefined && p.y !== undefined) root.soltarTela(p.porta, p.x, p.y)
    }
    return root.state()
  }

  ShellIpc {
    target: "arranjo-telas"

    function open(): string { return root.open("{}") }
    function close(): string { return root.close() }
    function toggle(): string { return root.toggle() }
    function state(): string { return root.state() }
    function semear(): string { return root.semear() }
  }

  // ---- Derived values ----

  function telaDaPorta(lista, porta) {
    for (var i = 0; i < lista.length; i++) if (lista[i].porta === porta) return lista[i]
    return null
  }

  function internaDe(r) {
    if (r === null || !r.cruas) return null
    for (var i = 0; i < r.cruas.length; i++) if (r.cruas[i].interna) return r.cruas[i]
    return null
  }

  // D13: the internal screen is there and enabled.
  function internaLigada(r) {
    var t = root.internaDe(r)
    return t !== null && t.ligada !== false
  }

  // D4, on the raw hyprctl data (never after Geo.normalizar).
  function internaNaOrigem(r) {
    var t = root.internaDe(r)
    return t !== null && t.ligada !== false && !t.espelho && t.x === 0 && t.y === 0
  }

  function escalasDe(cruas) {
    var mapa = {}
    for (var i = 0; i < cruas.length; i++) mapa[cruas[i].porta] = cruas[i].escala120
    return mapa
  }

  function portasSemRegra(telas, regras) {
    var saida = []
    for (var i = 0; i < telas.length; i++) {
      if (!telas[i].interna && !Dados.temRegra(regras, telas[i].porta)) saida.push(telas[i].porta)
    }
    return saida
  }

  // The live screens with the pending edits on top (normalized coordinates).
  function aplicarEdicoes(telas, edicoes) {
    var saida = []
    for (var i = 0; i < telas.length; i++) {
      var t = Object.assign({}, telas[i])
      var e = Object.prototype.hasOwnProperty.call(edicoes, t.porta) ? edicoes[t.porta] : null
      if (e !== null) {
        t.x = e.x
        t.y = e.y
        var partes = /^([0-9]+)x([0-9]+)@([0-9.]+)$/.exec(String(e.modo))
        if (partes !== null && (e.modo !== t.modo || e.transform !== t.transform)) {
          var escala = t.escala120 > 0 ? t.escala120 / 120 : t.escala
          var tamanho = Geo.tamanhoLogico(Number(partes[1]), Number(partes[2]), escala, e.transform)
          t.w = Number(partes[1])
          t.h = Number(partes[2])
          t.hz = Number(partes[3])
          t.modo = e.modo
          t.transform = e.transform
          t.escala120 = tamanho.escala120
          t.logW = tamanho.logW
          t.logH = tamanho.logH
          t.fracionaria = tamanho.fracionaria
        }
      }
      saida.push(t)
    }
    return saida
  }

  // Edits = every movable screen of `novas` that differs from the live one.
  function usarNovas(novas) {
    var vivas = root.telas
    var edicoes = {}
    for (var i = 0; i < novas.length; i++) {
      var n = novas[i]
      var v = root.telaDaPorta(vivas, n.porta)
      if (v === null || n.interna || !n.movel) continue
      if (n.x !== v.x || n.y !== v.y || n.modo !== v.modo || n.transform !== v.transform)
        edicoes[n.porta] = { x: n.x, y: n.y, modo: n.modo, transform: n.transform }
    }
    priv.edicoes = edicoes
    priv.avisoAtual = null
  }

  // Spec 8.10 priority. maxTelas first, then the laptop panel off; a notice
  // from the last action (Fluxo `avisar`) comes next, then bands 2 to 6.
  // `args` are plain values; band 2 carries the motivo code (the UI shows
  // strings.t("motivo." + code)).
  function calcularFaixa(leitura, edp1Ligado, edp1NaOrigem, salvo, semRegra, validacao, aviso, telaNova,
                         alvo, salvoEntradas, regras, fantasmas) {
    // vao: the arrangement has a gap or an overlap, so the band offers Corrigir
    // even when a notice from the last action takes its place.
    var temVao = validacao.sobreposicoes.length > 0 || validacao.ilhas.length > 0
    var faixa = function (chave, args) { return { chave: chave, args: args, vao: chave === "faixa.vao" } }
    if (leitura !== null && leitura.ok === false && leitura.motivo === "maxTelas")
      return faixa("faixa.maxTelas", [Geo.MAX_TELAS])
    if (leitura !== null && !edp1Ligado) return faixa("faixa.notebookDesligado", [])
    if (aviso !== null) {
      var comAviso = faixa(aviso.chave, aviso.args)
      comAviso.vao = temVao
      return comAviso
    }
    if (salvo.existe && !salvo.ok) return faixa("faixa.arquivoInvalido", [salvo.linha, salvo.motivo])
    if (semRegra.length > 0) return faixa("faixa.semRegra", [semRegra[0]])
    if (validacao.sobreposicoes.length > 0 || validacao.ilhas.length > 0) return faixa("faixa.vao", [])
    if (telaNova !== "") {
      var nova = root.telaDaPorta(alvo, telaNova)
      if (nova !== null && !Dados.conhecida(nova, salvoEntradas, regras, alvo)) return faixa("faixa.telaNova", [nova.desc, nova.porta])
    }
    if (leitura !== null && !edp1NaOrigem) return faixa("faixa.edp1Fora", [])
    if (validacao.sobreFantasma.length > 0) {
      var par = validacao.sobreFantasma[0]
      var nome = par[1]
      for (var i = 0; i < fantasmas.length; i++) {
        if (fantasmas[i].chave === par[1]) nome = fantasmas[i].desc !== Dados.SEM_VALOR ? fantasmas[i].desc : fantasmas[i].porta
      }
      return faixa("faixa.sobreFantasma", [par[0], nome])
    }
    if (validacao.estreitos.length > 0) return faixa("faixa.estreito", [validacao.estreitos[0][0], validacao.estreitos[0][1]])
    return faixa("", [])
  }

  function calcularMotivoAplicar(fluxo, leitura, edp1NaOrigem, validacao, diferencas) {
    if (fluxo.nome === "somenteLeitura") return "aplicar.somenteLeitura"
    if (fluxo.nome !== "editando") return ""
    if (leitura === null) return "aplicar.semMudanca"
    if (leitura.ok === false && leitura.motivo === "maxTelas") return "faixa.maxTelas"
    if (!edp1NaOrigem) return "faixa.edp1Fora"
    if (validacao.bloqueia) return "aplicar.bloqueia"
    if (diferencas.length === 0) return "aplicar.semMudanca"
    return ""
  }

  function hoje() {
    return Qt.formatDate(new Date(), "yyyy-MM-dd")
  }

  function texto(chave, args) {
    var s = strings.t(chave)
    var lista = Array.isArray(args) ? args : []
    for (var i = 0; i < lista.length; i++) s = s.arg(String(lista[i]))
    return s
  }

  // ---- Reading ----

  function montarLeitura(json, regras) {
    var r = Geo.lerMonitores(json, regras)
    var cruas = r.telas.concat(r.fora)
    var vivas = Geo.normalizar(cruas).telas
    var telas = []
    var fora = []
    for (var i = 0; i < vivas.length; i++) {
      if (vivas[i].ligada !== false && !vivas[i].espelho) telas.push(vivas[i])
      else fora.push(vivas[i])
    }
    return { ok: r.ok, motivo: r.motivo, cruas: cruas, vivas: vivas, telas: telas, fora: fora }
  }

  // Fresh `hyprctl monitors all -j` plus the rules; `depois(r)` gets the read
  // (null when hyprctl failed).
  function lerAgora(depois) {
    root.executar(["hyprctl", "monitors", "all", "-j"], null, function (codigo, saida, erro) {
      if (codigo !== 0) {
        console.warn(root.logTag, "hyprctl monitors failed, exit", codigo)
        if (depois) depois(null)
        return
      }
      root.lerRegrasAgora()
      var r = root.montarLeitura(saida, priv.regras)
      if (!r.ok) console.warn(root.logTag, "screen read refused:", r.motivo)
      priv.leitura = r
      root.depoisDaLeitura(r)
      if (depois) depois(r)
    })
  }

  function depoisDaLeitura(r) {
    var portas = {}
    for (var i = 0; i < r.telas.length; i++) portas[r.telas[i].porta] = true
    var edicoes = {}
    var mudou = false
    for (var p in priv.edicoes) {
      if (portas[p] === true) edicoes[p] = priv.edicoes[p]
      else mudou = true
    }
    if (mudou) priv.edicoes = edicoes
    var ligado = root.internaLigada(r)
    if ((priv.fluxo.nome === "editando" && !ligado) || (priv.fluxo.nome === "somenteLeitura" && ligado))
      root.enviar({ tipo: "edp1", ligado: ligado })
  }

  function lerRegrasAgora() {
    monitorsFile.reload()
    priv.regras = Dados.regrasDoMonitorsLua(monitorsFile.text())
  }

  function lerTsvAgora() {
    tsvFile.reload()
    var texto = tsvFile.text()
    return { existe: texto !== "" || !priv.tsvFalhou, texto: texto }
  }

  function atualizarSalvoDe(lido) {
    if (!lido.existe) {
      priv.salvo = { existe: false, ok: false, entradas: [], linha: 0, motivo: "" }
      return
    }
    var p = Dados.lerTsv(lido.texto)
    if (p.ok) priv.salvo = { existe: true, ok: true, entradas: p.entradas, linha: 0, motivo: "" }
    else {
      console.warn(root.logTag, "saved arrangement invalid at line", p.linha, p.motivo)
      priv.salvo = { existe: true, ok: false, entradas: [], linha: p.linha, motivo: p.motivo }
    }
  }

  function atualizarSalvo() {
    root.atualizarSalvoDe(root.lerTsvAgora())
  }

  // Atomic write (FileView atomicWrites), read back and compared.
  function escreverArquivo(entradas) {
    var w = Dados.escreverTsv(entradas)
    if (!w.ok) return { ok: false, motivo: w.motivo }
    tsvFile.setText(w.texto)
    var lido = root.lerTsvAgora()
    root.atualizarSalvoDe(lido)
    if (!lido.existe || lido.texto !== w.texto) {
      console.warn(root.logTag, "saved arrangement did not read back as written")
      return { ok: false, motivo: "escrita" }
    }
    return { ok: true, motivo: "" }
  }

  // ---- Processes ----

  Component {
    id: processoComp

    Process {
      id: proc
      property var aoTerminar: null
      property bool estourou: false
      stdout: StdioCollector { id: saidaProc }
      stderr: StdioCollector { id: erroProc }
      property Timer limite: Timer {
        interval: root.limiteProcessoMs
        running: proc.running
        repeat: false
        onTriggered: {
          console.warn(root.logTag, "process timed out, killing:", proc.command[0])
          proc.estourou = true
          proc.signal(9)
        }
      }
      onExited: function (codigo, status) {
        var f = proc.aoTerminar
        proc.aoTerminar = null
        if (typeof f === "function") {
          try {
            f(proc.estourou ? -1 : codigo, saidaProc.text, erroProc.text)
          } catch (e) {
            console.warn(root.logTag, "process callback failed:", e)
          }
        }
        proc.destroy()
      }
    }
  }

  function executar(comando, ambiente, aoTerminar) {
    var props = { command: comando, aoTerminar: aoTerminar || null }
    if (ambiente) props.environment = ambiente
    var p = processoComp.createObject(root, props)
    if (p === null) {
      console.warn(root.logTag, "could not create a process for", comando[0])
      if (aoTerminar) aoTerminar(-1, "", "")
      return
    }
    p.running = true
  }

  // `hyprctl eval`: success is exit 0 with "ok"; a non-zero exit never comes
  // back as "ok", whatever stdout says. An empty snippet is never sent.
  function rodarEval(trecho, depois) {
    if (typeof trecho !== "string" || trecho === "") {
      console.warn(root.logTag, "empty eval snippet, not sent")
      depois("")
      return
    }
    root.executar(["hyprctl", "eval", trecho], null, function (codigo, saida, erro) {
      var s = String(saida || "")
      if (codigo !== 0) s = ("exit " + codigo + ": " + String(erro || saida || "")).trim()
      if (s.trim() !== Fluxo.SAIDA_OK) console.warn(root.logTag, "eval answered:", s.trim().slice(0, 200))
      depois(s)
    })
  }

  // The guard script runs one call at a time, in order, so a late `armar`
  // can never cross a `desarmar` (task 7, concern 1).
  function guardaEnfileirar(args, aoTerminar) {
    priv.filaGuarda = priv.filaGuarda.concat([{ args: args, aoTerminar: aoTerminar }])
    root.guardaProxima()
  }

  function guardaProxima() {
    if (priv.guardaRodando || priv.filaGuarda.length === 0) return
    var item = priv.filaGuarda[0]
    priv.filaGuarda = priv.filaGuarda.slice(1)
    priv.guardaRodando = true
    root.executar(["bash", root.scriptGuarda].concat(item.args), null, function (codigo, saida, erro) {
      priv.guardaRodando = false
      if (codigo !== 0) console.warn(root.logTag, "guard", item.args[0], "exit", codigo)
      if (item.aoTerminar) item.aoTerminar(codigo)
      root.guardaProxima()
    })
  }

  function notificar(mensagem) {
    var m = String(mensagem).replace(/[\r\n]+/g, " ")
    root.executar(["notify-send", "-a", strings.t("notif.titulo"), m], null, null)
  }

  // ---- State machine ----

  function enviar(evento) {
    var antes = priv.fluxo
    var r = Fluxo.transicao(antes, evento)
    if (r.estado !== antes) priv.fluxo = r.estado
    for (var i = 0; i < r.efeitos.length; i++) root.executarEfeito(r.efeitos[i])
    if (r.estado !== antes) root.mudouEstado(antes.nome, r.estado.nome)
  }

  function mudouEstado(de, para) {
    if (de !== para) console.info(root.logTag, "state", de, "->", para)
    if (para === "fechado") {
      priv.edicoes = ({})
      priv.arrasto = null
      priv.selecionada = ""
      priv.avisoAtual = null
      priv.telaNova = ""
      priv.confirmacaoVisivel = false
      priv.fecharPendente = false
    }
    if (de === "confirmando" && para === "gravando") priv.edicoes = ({})
    if (para !== "confirmando") contagem.stop()
    var saiu = root.estadosOcupados.indexOf(de) >= 0 && root.estadosOcupados.indexOf(para) < 0
    if (saiu && priv.eventoNoMeio) {
      priv.eventoNoMeio = false
      debounce.restart()
    }
    if (priv.fecharPendente && (para === "editando" || para === "somenteLeitura")) {
      priv.fecharPendente = false
      Qt.callLater(function () { root.enviar({ tipo: "fechar" }) })
    }
  }

  function executarEfeito(ef) {
    switch (ef.tipo) {
    case "armarGuarda":
      root.guardaEnfileirar(["armar", ef.id, ef.aviso, ef.volta], function (codigo) {
        root.enviar({ tipo: "guarda", ok: codigo === 0 })
      })
      break
    case "desarmarGuarda":
      root.guardaEnfileirar(["desarmar", ef.id], null)
      break
    case "eval":
      root.rodarEval(ef.trecho, function (saida) { root.enviar({ tipo: "evalRespondeu", saida: saida }) })
      break
    case "lerDeVolta":
      root.iniciarLeituraDeVolta(ef.esperado)
      break
    case "mostrarConfirmacao":
      priv.confirmacaoVisivel = true
      break
    case "fecharConfirmacao":
      priv.confirmacaoVisivel = false
      break
    case "iniciarContagem":
      contagem.restart()
      break
    case "pararContagem":
      contagem.stop()
      break
    case "reload":
      root.executar(["hyprctl", "reload"], null, function () { root.enviar({ tipo: "recarregou" }) })
      break
    case "esperarVolta":
      root.esperarVolta(ef.porta, ef.ms)
      break
    case "cancelarEspera":
      root.cancelarEspera(ef.porta)
      break
    case "gravarTsv":
      root.gravarTsv(ef.origem, ef.chave)
      break
    case "avisar":
      root.avisar(ef.chave, ef.args)
      break
    case "mostrarEsquecer":
    case "fecharEsquecer":
      break   // dialogoEsquecer is bound to the model's own `dialogo`
    default:
      console.warn(root.logTag, "unknown effect", ef.tipo)
    }
  }

  function avisar(chave, args) {
    var a = { chave: String(chave), args: Array.isArray(args) ? args.slice() : [] }
    console.info(root.logTag, "notice", a.chave)
    if (root.opened) priv.avisoAtual = a
    else root.notificar(root.texto(a.chave, a.args))
  }

  function iniciarLeituraDeVolta(esperado) {
    priv.esperadoLeitura = Array.isArray(esperado) ? esperado : []
    priv.lendoDecorrido = 0
    priv.ultimaLeituraVolta = null
    leituraVolta.restart()
    root.lerParaVolta()
  }

  function passoLeituraDeVolta() {
    if (priv.fluxo.etapa !== "lendo") {
      leituraVolta.stop()
      return
    }
    priv.lendoDecorrido += Fluxo.LEITURA_PASSO_MS
    if (priv.lendoDecorrido >= Fluxo.LEITURA_MS) {
      leituraVolta.stop()
      var ultima = priv.ultimaLeituraVolta
      root.enviar({ tipo: "leituraEsgotada", detalhe: root.detalheLeitura(), telas: ultima !== null ? ultima.cruas : null })
      return
    }
    root.lerParaVolta()
  }

  function lerParaVolta() {
    root.lerAgora(function (r) {
      if (r === null || priv.fluxo.etapa !== "lendo") return
      priv.ultimaLeituraVolta = r
      root.enviar({ tipo: "leitura", telas: r.cruas })
    })
  }

  // What the last read-back saw on the target ports, for aviso.outraCoisa.
  function detalheLeitura() {
    var r = priv.ultimaLeituraVolta
    var partes = []
    for (var i = 0; i < priv.esperadoLeitura.length; i++) {
      var porta = priv.esperadoLeitura[i].porta
      var t = r !== null ? root.telaDaPorta(r.cruas, porta) : null
      partes.push(t === null ? porta + " -" : porta + " " + t.modo + " " + t.x + "x" + t.y + " " + t.transform)
    }
    return partes.join(", ")
  }

  function esperarVolta(porta, ms) {
    root.cancelarEspera(porta)
    var t = esperaComp.createObject(root, { porta: porta, interval: ms })
    if (t === null) return
    var mapa = Object.assign({}, priv.esperas)
    mapa[porta] = t
    priv.esperas = mapa
    t.start()
  }

  function cancelarEspera(porta) {
    if (!Object.prototype.hasOwnProperty.call(priv.esperas, porta)) return
    var t = priv.esperas[porta]
    var mapa = Object.assign({}, priv.esperas)
    delete mapa[porta]
    priv.esperas = mapa
    t.stop()
    t.destroy()
  }

  function semVolta(porta) {
    root.cancelarEspera(porta)
    root.enviar({ tipo: "semVolta", porta: porta })
  }

  // Manter and Esquecer: merge over the file as it is on disk right now. An
  // invalid file is never written over (I3, Fluxo.planejarGravacao).
  function gravarTsv(origem, chave) {
    root.lerAgora(function (r) {
      var ok = false
      var motivo = ""
      if (r !== null && r.ok) {
        var plano = Fluxo.planejarGravacao(origem, chave, root.lerTsvAgora(), r.vivas, priv.regras, root.hoje())
        if (plano.ok) {
          var w = root.escreverArquivo(plano.entradas)
          ok = w.ok
          if (!w.ok) console.warn(root.logTag, "save refused:", w.motivo)
        } else {
          motivo = plano.motivo
          console.warn(root.logTag, origem + " refused:", plano.motivo)
        }
      }
      root.enviar({ tipo: "gravou", ok: ok, motivo: motivo })
    })
  }

  // Aplicar (spec 8.6 step 1) on a fresh read.
  function montarAplicar(r) {
    if (r === null || !r.ok || priv.fluxo.nome !== "editando") return
    if (!root.internaNaOrigem(r)) {
      priv.avisoAtual = { chave: "faixa.edp1Fora", args: [] }
      return
    }
    var alvoTelas = root.aplicarEdicoes(r.telas, priv.edicoes)
    var vivasAlvo = alvoTelas.concat(r.fora)
    var difs = Dados.diferencas(vivasAlvo, root.salvoEntradas, priv.regras)
    if (difs.length === 0) {
      priv.avisoAtual = { chave: "aplicar.semMudanca", args: [] }
      return
    }
    if (Geo.validar(alvoTelas, Dados.fantasmas(root.salvoEntradas, r.vivas, priv.regras)).bloqueia) {
      priv.avisoAtual = { chave: "aplicar.bloqueia", args: [] }
      return
    }
    var alvo = []
    var antes = []
    for (var i = 0; i < difs.length; i++) {
      var t = root.telaDaPorta(alvoTelas, difs[i].porta)
      var c = root.telaDaPorta(r.cruas, difs[i].porta)
      if (t === null || c === null) continue
      alvo.push({ porta: t.porta, desc: Dados.descDoAlvo(t, vivasAlvo), modo: t.modo, x: t.x, y: t.y, transform: t.transform })
      antes.push({ porta: c.porta, desc: Dados.descDoAlvo(c, r.cruas), modo: c.modo, x: c.x, y: c.y, transform: c.transform })
    }
    var ida = Dados.montarEval(alvo, priv.regras)
    var volta = Dados.montarEval(antes, priv.regras)
    if (!ida.ok || !volta.ok || ida.trecho === "" || volta.trecho === "") {
      var motivo = !ida.ok ? ida.motivo : (!volta.ok ? volta.motivo : "vazio")
      console.warn(root.logTag, "apply refused by montarEval:", motivo)
      priv.avisoAtual = { chave: "eval." + motivo, args: [] }
      return
    }
    root.enviar({ tipo: "aplicar", id: Fluxo.novoId(Math.random), aviso: strings.t("notif.guarda"),
                  ida: ida.trecho, volta: volta.trecho, alvo: alvo, antes: antes, regras: priv.regras,
                  escalasAntes: root.escalasDe(r.cruas), edp1NaOrigem: root.internaNaOrigem(r) })
  }

  // ---- Screen events and reconciler (spec 8.7) ----

  function notarGatilho(nome) {
    if (root.prioridadeGatilho.indexOf(nome) > root.prioridadeGatilho.indexOf(priv.gatilho)) priv.gatilho = nome
    if (nome === "configreloaded") priv.limparMemorias = true
  }

  function eventoHyprland(nome, dado) {
    if (root.eventosDeTela.indexOf(nome) < 0) return
    root.notarGatilho(nome)
    var e = priv.fluxo.nome
    if (root.estadosComTransicao.indexOf(e) >= 0) {
      priv.eventoNoMeio = true
      if (nome === "configreloaded") root.enviar({ tipo: "configRecarregada" })
      else root.enviar({ tipo: "tela", nome: nome, porta: Fluxo.portaDoEvento(dado) })
      return
    }
    root.chegouEvento()
  }

  function chegouEvento() {
    if (root.estadosOcupados.indexOf(priv.fluxo.nome) >= 0) {
      priv.eventoNoMeio = true
      return
    }
    debounce.restart()
  }

  function semMemoriaVelha(mapa, cruas) {
    var saida = {}
    for (var porta in mapa) {
      var t = root.telaDaPorta(cruas, porta)
      if (t !== null && t.desc === mapa[porta]) saida[porta] = mapa[porta]
    }
    return saida
  }

  function comChave(mapa, chave, valor) {
    var novo = Object.assign({}, mapa)
    novo[chave] = valor
    return novo
  }

  function reconciliar() {
    if (priv.reconciliando) {
      priv.reconciliarDeNovo = true
      return
    }
    if (root.estadosOcupados.indexOf(priv.fluxo.nome) >= 0) {
      priv.eventoNoMeio = true
      return
    }
    var gatilho = priv.gatilho !== "" ? priv.gatilho : "monitorsLua"
    var limpar = priv.limparMemorias
    priv.gatilho = ""
    priv.limparMemorias = false
    priv.reconciliando = true
    root.atualizarSalvo()
    root.lerAgora(function (r) {
      if (r === null) {
        root.terminarReconciliacao()
        return
      }
      if (limpar) {
        priv.neutralizadas = ({})
        priv.aplicadas = ({})
      }
      priv.neutralizadas = root.semMemoriaVelha(priv.neutralizadas, r.cruas)
      priv.aplicadas = root.semMemoriaVelha(priv.aplicadas, r.cruas)
      var acoes = Fluxo.reconciliar(r.cruas, root.salvoEntradas, priv.regras, priv.neutralizadas,
                                    root.internaLigada(r), priv.fluxo.nome, priv.aplicadas)
      console.info(root.logTag, "reconcile trigger=" + gatilho + " actions=" + acoes.length)
      root.rodarAcoes(acoes, 0, function () { root.depoisDasAcoes(gatilho, acoes.length > 0, r) })
    })
  }

  // I14: asked before every eval of a reconciler sequence. When the flow left
  // the idle states (an Aplicar started meanwhile) the sequence stops with no
  // eval and no memory written; the end of the change reconciles again.
  function reconciliadorAbortou() {
    if (Fluxo.reconciliadorPodeAgir(priv.fluxo)) return false
    console.info(root.logTag, "reconcile aborted: flow is", priv.fluxo.nome)
    priv.eventoNoMeio = true
    return true
  }

  function rodarAcoes(acoes, i, fim) {
    if (i >= acoes.length) {
      fim()
      return
    }
    var parar = function () { root.terminarReconciliacao() }
    if (root.reconciliadorAbortou()) {
      parar()
      return
    }
    var a = acoes[i]
    var seguir = function () { root.rodarAcoes(acoes, i + 1, fim) }
    if (a.tipo === "aplicarSalvo") {
      root.aplicarSalvo(a, seguir, parar)
    } else if (a.tipo === "neutralizar") {
      root.neutralizar(a, seguir, parar)
    } else {
      seguir()
    }
  }

  // Reconciler read-back (I1): Hyprland applies an eval on its next frame, so
  // one read right after it can still show the old values. Reads the screens
  // every LEITURA_PASSO_MS until pronto(r) holds or LEITURA_MS runs out, then
  // calls depois(r, esgotou) once; r is null when hyprctl failed. At most
  // LEITURA_MS / LEITURA_PASSO_MS + 1 reads.
  function lerAte(pronto, depois, decorrido) {
    root.lerAgora(function (r) {
      var feito = r !== null && pronto(r)
      if (r === null || feito || decorrido >= Fluxo.LEITURA_MS) {
        depois(r, !feito)
        return
      }
      passoReconciliador.aoDisparar = function () { root.lerAte(pronto, depois, decorrido + Fluxo.LEITURA_PASSO_MS) }
      passoReconciliador.restart()
    })
  }

  // One reconciler eval, then its read-back; depois() once the read shows
  // `esperado`, the window runs out, or the eval failed; parar() instead,
  // with no eval, when the flow is no longer idle (I14).
  function avaliarEConferir(trecho, esperado, depois, parar) {
    if (root.reconciliadorAbortou()) {
      parar()
      return
    }
    root.rodarEval(trecho, function (saida) {
      if (!Fluxo.evalOk(saida)) {
        depois()
        return
      }
      root.lerAte(function (r) { return Dados.bateu(esperado, r.cruas) }, function (r, esgotou) {
        if (esgotou) console.warn(root.logTag, "reconcile read-back did not match in time")
        depois()
      }, 0)
    })
  }

  // Spec 8.7 case c, with the scale check of a neutralization (D17). The
  // memory is written when the action ends after an eval Hyprland took, also
  // after a failure, so the volta's own events never loop (the reconciler
  // runs one pass at a time). A refused eval or an aborted sequence (I14)
  // writes none, and the next pass tries again.
  function aplicarSalvo(a, seguir, parar) {
    console.info(root.logTag, "reconcile: saved values on", a.porta)
    var escalasAntes = root.escalasDe(priv.leitura.cruas)
    var concluida = function () {
      priv.aplicadas = root.comChave(priv.aplicadas, a.porta, a.desc)
      seguir()
    }
    root.rodarEval(a.trecho, function (saida) {
      if (!Fluxo.evalOk(saida)) {
        seguir()
        return
      }
      var falhou = function (r) { return Fluxo.concluirAplicarSalvo(r.cruas, a.porta, escalasAntes).falha }
      root.lerAte(function (r) { return Dados.bateu(a.esperado, r.cruas) || falhou(r) }, function (r, esgotou) {
        if (r === null || !falhou(r)) {
          concluida()
          return
        }
        console.warn(root.logTag, "saved values changed the scale on", a.porta, "(D17)")
        root.notificar(root.texto("notif.salvoFalhou", [a.porta]))
        root.avaliarEConferir(a.volta, a.esperadoVolta, concluida, parar)
      }, 0)
    })
  }

  // Two steps (spec 8.7): preferred mode, then the gapless spot. The memory
  // follows the same rule as aplicarSalvo. The second step waits until the
  // read shows the preferred mode (I1, Fluxo.concluirNeutralizacao).
  function neutralizar(a, seguir, parar) {
    console.info(root.logTag, "reconcile: neutralizing", a.porta)
    var escalasAntes = root.escalasDe(priv.leitura.cruas)
    var concluida = function () {
      priv.neutralizadas = root.comChave(priv.neutralizadas, a.porta, a.desc)
      seguir()
    }
    var concluir = function (r, esgotou) {
      return Fluxo.concluirNeutralizacao(r.cruas, a.porta, escalasAntes, priv.regras, a.antes, esgotou)
    }
    root.rodarEval(a.trecho, function (saida) {
      if (!Fluxo.evalOk(saida)) {
        seguir()
        return
      }
      root.lerAte(function (r) { return concluir(r, false).esperar !== true }, function (r, esgotou) {
        if (r === null) {
          concluida()
          return
        }
        var c = concluir(r, true)
        if (c.falha) {
          console.warn(root.logTag, "neutralization failed on", a.porta, "(D17)")
          var t = root.telaDaPorta(r.cruas, a.porta)
          if (t !== null) {
            var chave = Dados.chaveTela(t, r.cruas)
            if (priv.oferecidas.indexOf(chave) < 0) priv.oferecidas = priv.oferecidas.concat([chave])
          }
          root.notificar(root.texto("notif.neutralizacaoFalhou", [a.porta]))
          root.avaliarEConferir(a.volta, a.esperadoVolta, concluida, parar)
        } else if (c.trecho !== "") {
          root.avaliarEConferir(c.trecho, c.esperado, concluida, parar)
        } else {
          concluida()
        }
      }, 0)
    })
  }

  function depoisDasAcoes(gatilho, agiu, leituraAntes) {
    var continuar = function (r) {
      if (r === null) {
        root.terminarReconciliacao()
        return
      }
      if (root.internaLigada(r) && root.internaNaOrigem(r)) {
        var v = Fluxo.avisoDeVao(r.vivas, Dados.fantasmas(root.salvoEntradas, r.vivas, priv.regras), priv.ultimoVao)
        priv.ultimoVao = v.assinatura
        if (v.avisar) root.notificar(strings.t("notif.vao"))
      }
      if (Fluxo.GATILHOS_QUE_ABREM.indexOf(gatilho) >= 0) {
        root.executar(["omarchy-shell", "lock", "isLocked"], { OMARCHY_SHELL_IPC_TIMEOUT: root.tempoIpc },
                      function (codigo, saida) {
          root.decidir(gatilho, r, !(codigo === 0 && String(saida).trim() === root.saidaDestravada))
        })
      } else {
        root.decidir(gatilho, r, true)
      }
    }
    if (agiu) root.lerAgora(continuar)
    else continuar(leituraAntes)
  }

  function decidir(gatilho, r, travada) {
    var d = Fluxo.decidirAbertura({
      gatilho: gatilho, vivas: r.cruas, salvo: root.salvoEntradas, regras: priv.regras,
      regrasAntes: priv.regrasAntes, oferecidas: priv.oferecidas,
      conhecidasSemArquivo: priv.conhecidasSemArquivo, estado: priv.fluxo.nome, travada: travada,
      edp1Ligado: root.internaLigada(r), painelAberto: root.opened
    })
    priv.regrasAntes = priv.regras
    priv.oferecidas = d.oferecidas
    for (var i = 0; i < d.notificacoes.length; i++)
      root.notificar(root.texto(d.notificacoes[i].chave, d.notificacoes[i].args))
    if (d.abrir) {
      console.info(root.logTag, "auto-open for", d.porta)
      priv.telaNova = d.porta
      if (!root.opened) root.open(JSON.stringify({ porta: d.porta }))
      else root.selecionar(d.porta)
    }
    root.terminarReconciliacao()
  }

  function terminarReconciliacao() {
    priv.reconciliando = false
    if (priv.reconciliarDeNovo) {
      priv.reconciliarDeNovo = false
      debounce.restart()
    }
  }

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      root.eventoHyprland(String(event.name || ""), String(event.data || ""))
    }
  }

  Timer {
    id: debounce
    interval: Fluxo.DEBOUNCE_MS
    repeat: false
    onTriggered: root.reconciliar()
  }

  Timer {
    id: passoReconciliador
    property var aoDisparar: null
    interval: Fluxo.LEITURA_PASSO_MS
    repeat: false
    onTriggered: {
      var f = passoReconciliador.aoDisparar
      passoReconciliador.aoDisparar = null
      if (typeof f === "function") f()
    }
  }

  Timer {
    id: leituraVolta
    interval: Fluxo.LEITURA_PASSO_MS
    repeat: true
    onTriggered: root.passoLeituraDeVolta()
  }

  Timer {
    id: contagem
    interval: root.contagemPassoMs
    repeat: true
    onTriggered: {
      if (priv.fluxo.nome !== "confirmando") {
        contagem.stop()
        return
      }
      root.enviar({ tipo: "tique" })
    }
  }

  Component {
    id: esperaComp

    Timer {
      property string porta: ""
      repeat: false
      onTriggered: root.semVolta(porta)
    }
  }

  FileView {
    id: monitorsFile
    path: root.caminhoMonitors
    watchChanges: true
    printErrors: false
    blockLoading: true
    blockAllReads: true
    onFileChanged: {
      root.lerRegrasAgora()
      root.notarGatilho("monitorsLua")
      root.chegouEvento()
    }
  }

  FileView {
    id: tsvFile
    path: root.caminhoTsv
    watchChanges: true
    atomicWrites: true
    printErrors: false
    blockLoading: true
    blockAllReads: true
    blockWrites: true
    onLoaded: priv.tsvFalhou = false
    onLoadFailed: function (erro) { priv.tsvFalhou = true }
    onFileChanged: root.atualizarSalvo()
  }

  // Start (spec 8.6 step 5, 8.7): the guard checks for a stale mark, then the
  // first read; without a file the screens on now count as already known.
  Component.onCompleted: {
    console.info(root.logTag, "started")
    root.guardaEnfileirar(["partida"], null)
    root.atualizarSalvo()
    root.lerAgora(function (r) {
      if (r !== null && !priv.salvo.existe) {
        var chaves = []
        for (var i = 0; i < r.telas.length; i++) chaves.push(Dados.chaveTela(r.telas[i], r.cruas))
        priv.conhecidasSemArquivo = chaves
      }
      root.notarGatilho("partida")
      root.reconciliar()
    })
  }
}
