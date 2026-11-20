import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// The arrangement panel (spec 8.10). A PanelWindow of its own, always on the
// laptop panel (eDP-1, never a target, D12), so the screens it moves can
// close and reopen their own layers without touching it. It reveals itself
// like Ui/OverlayWindow.qml (opacity 0 until the size and scale arrive) but
// never follows the focused screen. A click outside the card does nothing.
// Every edit goes through the root (`arranjo`); nothing here changes a screen.
PanelWindow {
  id: janela

  required property var arranjo
  required property var strings

  readonly property string portaInterna: "eDP-1"
  readonly property int msEntrada: 180
  readonly property int msSaida: 120
  readonly property real escalaInicial: 0.97
  readonly property int larguraCartao: Style.space(720)
  readonly property int alturaArea: Style.space(250)
  readonly property real fracaoMaxima: 0.92      // of the screen, for the card
  readonly property real opacidadeDesabilitado: 0.45

  // Same [menu] surface tokens as the window-switcher.
  readonly property color corFundo: Commons.Color.menu.background
  readonly property color corTexto: Commons.Color.menu.text
  readonly property color corBorda: Commons.Color.menu.border
  readonly property color corScrim: Commons.Color.menu.scrim
  readonly property color corSelecionadaFundo: Commons.Color.menu.selectedBackground
  readonly property color corSelecionadaTexto: Commons.Color.menu.selectedText
  readonly property color corAviso: Commons.Color.urgent
  readonly property string familia: Style.font.menuFamily

  // ---- Screen: fixed on eDP-1; only somenteLeitura with it off uses another ----
  readonly property var telaFixa: janela.escolherTela(Quickshell.screens, janela.arranjo.estado)
  readonly property var monitorFixo: {
    var lista = Hyprland.monitors.values
    for (var i = 0; i < lista.length; i++) {
      if (janela.telaFixa && lista[i].name === janela.telaFixa.name) return lista[i]
    }
    return null
  }

  function escolherTela(telas, estado) {
    for (var i = 0; i < telas.length; i++) if (telas[i].name === janela.portaInterna) return telas[i]
    if (estado === "somenteLeitura" && telas.length > 0) return telas[0]
    return null
  }

  // ---- Open, close and the reveal ----
  readonly property bool pedido: janela.arranjo.opened
  property bool saindo: false
  readonly property bool mostrada: janela.pedido || janela.saindo
  readonly property bool comDialogo: janela.arranjo.confirmacaoVisivel || janela.arranjo.dialogoEsquecer !== ""
  readonly property bool temFoco: janela.pedido && !janela.comDialogo

  readonly property bool conteudoPronto: janela.mostrada && janela.backingWindowVisible && !!janela.telaFixa
    && janela.width === janela.telaFixa.width && janela.height === janela.telaFixa.height
    && !!janela.monitorFixo && Math.round(janela.devicePixelRatio * 120) === Math.round(janela.monitorFixo.scale * 120)
  property bool conteudoRevelado: false
  readonly property bool aberto: janela.pedido && janela.conteudoRevelado

  onConteudoProntoChanged: {
    janela.conteudoRevelado = false
    if (janela.conteudoPronto) Qt.callLater(function () {
      if (janela.conteudoPronto) janela.conteudoRevelado = true
    })
  }

  onPedidoChanged: {
    if (janela.pedido) {
      saidaTimer.stop()
      janela.saindo = false
      Hyprland.refreshMonitors()
    } else {
      janela.saindo = true
      saidaTimer.restart()
    }
  }
  onTemFocoChanged: if (janela.temFoco) teclas.forceActiveFocus()
  onVisibleChanged: if (janela.visible) teclas.forceActiveFocus()

  Timer {
    id: saidaTimer
    interval: Style.duration(janela.msSaida)
    repeat: false
    onTriggered: janela.saindo = false
  }

  visible: janela.mostrada && janela.telaFixa !== null
  screen: janela.telaFixa
  anchors { top: true; left: true; bottom: true; right: true }
  color: "transparent"
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.namespace: "cateim-arranjo-telas"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.keyboardFocus: janela.temFoco ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  Binding {
    target: janela.contentItem
    property: "opacity"
    value: janela.conteudoRevelado ? 1 : 0
  }

  // ---- Helpers shared with AreaTelas, DetalhesTela and JanelaConfirmacao ----

  function numero(v) {
    return Commons.I18n.formatNumber(Number(Number(v).toFixed(2)))
  }

  function texto(chave, args) {
    var s = janela.strings.t(chave)
    var lista = Array.isArray(args) ? args : []
    for (var i = 0; i < lista.length; i++) s = s.arg(String(lista[i]))
    return s
  }

  // Short name: the model part of an EDID description (after " - ", without a
  // trailing serial), "Notebook" for the internal port, the port if empty.
  function nomeCurto(desc, porta) {
    if (/^(eDP|LVDS|DSI)-/.test(String(porta || ""))) return janela.strings.t("notebook")
    var d = String(desc || "")
    var corte = d.lastIndexOf(" - ")
    if (corte >= 0) d = d.slice(corte + 3)
    d = d.replace(/\s+0x[0-9A-Fa-f]+$/, "").trim()
    if (d === "" || d === "-") return String(porta || "")
    return d
  }

  function tamanhoModo(modo) {
    var p = /^([0-9]+)x([0-9]+)(?:@([0-9.]+))?/.exec(String(modo || ""))
    return p === null ? null : { w: Number(p[1]), h: Number(p[2]), hz: p[3] !== undefined ? Number(p[3]) : 0 }
  }

  function rotuloModo(modo) {
    var m = janela.tamanhoModo(modo)
    if (m === null) return String(modo || "")
    return janela.texto("modo.rotulo", [m.w, m.h, janela.numero(m.hz)])
  }

  function rotuloTamanho(modo) {
    var m = janela.tamanhoModo(modo)
    if (m === null) return String(modo || "")
    return janela.texto("tela.tamanho", [m.w, m.h])
  }

  function textoFaixa(f) {
    if (!f || f.chave === "") return ""
    var args = Array.isArray(f.args) ? f.args.slice() : []
    if (f.chave === "faixa.arquivoInvalido" && args.length > 1) args[1] = janela.strings.t("motivo." + args[1])
    if (f.chave === "faixa.telaNova" && args.length > 1) args[0] = janela.nomeCurto(args[0], args[1])
    if (f.chave === "faixa.sobreFantasma" && args.length > 1) args[1] = janela.nomeCurto(args[1], "")
    if (f.chave === "faixa.maxTelas" && args.length > 0) args[0] = janela.numero(args[0])
    // a notice from the last action never hides the gap (and its Corrigir)
    var vao = f.vao === true && f.chave !== "faixa.vao" ? " " + janela.strings.t("faixa.vao") : ""
    return janela.texto(f.chave, args) + vao
  }

  // ---- Selection (Tab / Shift+Tab): live screens first, then ghosts ----
  readonly property var ordemSelecao: {
    var saida = []
    var alvo = janela.arranjo.alvo
    for (var i = 0; i < alvo.length; i++) saida.push(alvo[i].porta)
    var fantasmas = janela.arranjo.fantasmas
    for (var j = 0; j < fantasmas.length; j++) saida.push(fantasmas[j].chave)
    return saida
  }

  readonly property string selecaoEfetiva: {
    var ordem = janela.ordemSelecao
    if (ordem.indexOf(janela.arranjo.selecionada) >= 0) return janela.arranjo.selecionada
    var alvo = janela.arranjo.alvo
    for (var i = 0; i < alvo.length; i++) if (!alvo[i].interna && alvo[i].movel) return alvo[i].porta
    for (var j = 0; j < alvo.length; j++) if (!alvo[j].interna) return alvo[j].porta
    return ordem.length > 0 ? ordem[0] : ""
  }

  function passarSelecao(passo) {
    var ordem = janela.ordemSelecao
    if (ordem.length === 0) return
    var i = ordem.indexOf(janela.selecaoEfetiva)
    var n = ordem.length
    janela.arranjo.selecionar(ordem[((i < 0 ? 0 : i + passo) % n + n) % n])
  }

  // ---- Drawing ----

  Rectangle {
    anchors.fill: parent
    color: janela.corScrim
    opacity: cartao.opacity

    MouseArea { anchors.fill: parent; onClicked: {} }
  }

  Item {
    id: teclas
    anchors.fill: parent
    focus: true

    Keys.onPressed: function (event) {
      if (!janela.temFoco) return
      if (event.key === Qt.Key_Backtab || (event.key === Qt.Key_Tab && (event.modifiers & Qt.ShiftModifier))) {
        janela.passarSelecao(-1)
        event.accepted = true
      } else if (event.key === Qt.Key_Tab) {
        janela.passarSelecao(1)
        event.accepted = true
      } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
        if (janela.arranjo.aplicarHabilitado) janela.arranjo.aplicar()
        event.accepted = true
      } else if (event.key === Qt.Key_Escape) {
        janela.arranjo.close()
        event.accepted = true
      }
    }
  }

  BorderSurface {
    id: cartao
    anchors.centerIn: parent
    width: Math.min(janela.larguraCartao, Math.round(janela.width * janela.fracaoMaxima))
    height: conteudo.implicitHeight + cartao.contentTopInset + cartao.contentBottomInset
    radius: Style.cornerRadius
    color: janela.corFundo
    borderSpec: Border.surfaceSpec("menu", "border", janela.corBorda, Math.max(1, Style.space(2)))
    padding: Style.spacing.panelPadding

    opacity: janela.aberto ? 1 : 0
    scale: janela.aberto ? 1 : janela.escalaInicial
    Behavior on opacity {
      NumberAnimation { duration: Style.duration(janela.pedido ? janela.msEntrada : janela.msSaida); easing.type: Easing.OutCubic }
    }
    Behavior on scale {
      NumberAnimation { duration: Style.duration(janela.pedido ? janela.msEntrada : janela.msSaida); easing.type: Easing.OutCubic }
    }

    MouseArea { anchors.fill: parent; onClicked: teclas.forceActiveFocus() }

    Column {
      id: conteudo
      x: cartao.contentLeftInset
      y: cartao.contentTopInset
      width: cartao.width - cartao.contentLeftInset - cartao.contentRightInset
      spacing: Style.spacing.xl

      // Title, the "different from saved" mark and close.
      Item {
        width: parent.width
        height: Math.max(titulo.implicitHeight, botaoFechar.implicitHeight)

        Text {
          id: titulo
          textFormat: Text.PlainText
          anchors.left: parent.left
          anchors.verticalCenter: parent.verticalCenter
          text: janela.strings.t("titulo")
          color: janela.corTexto
          font.family: janela.familia
          font.pixelSize: Style.font.heading
          font.bold: true
        }

        Text {
          textFormat: Text.PlainText
          anchors.right: botaoFechar.left
          anchors.rightMargin: Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
          visible: janela.arranjo.diferencasAtuais.length > 0
          text: "* " + janela.strings.t("diferente.titulo")
          color: janela.corSelecionadaTexto
          font.family: janela.familia
          font.pixelSize: Style.font.bodySmall
        }

        Button {
          id: botaoFechar
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: janela.strings.t("fechar")
          foreground: janela.corTexto
          bordered: true
          onClicked: janela.arranjo.close()
        }
      }

      AreaTelas {
        width: parent.width
        height: janela.alturaArea
        arranjo: janela.arranjo
        strings: janela.strings
        painel: janela
        selecionada: janela.selecaoEfetiva
      }

      // One band at a time, in the root's priority order.
      Rectangle {
        width: parent.width
        visible: janela.arranjo.faixa.chave !== ""
        height: visible ? Math.max(faixaTexto.implicitHeight, botaoCorrigir.visible ? botaoCorrigir.implicitHeight : 0) + Style.spacing.lg * 2 : 0
        color: Qt.rgba(janela.corAviso.r, janela.corAviso.g, janela.corAviso.b, 0.12)
        border.color: janela.corAviso
        border.width: 1
        radius: Style.cornerRadius

        Text {
          id: faixaTexto
          textFormat: Text.PlainText
          anchors.left: parent.left
          anchors.right: botaoCorrigir.visible ? botaoCorrigir.left : parent.right
          anchors.verticalCenter: parent.verticalCenter
          anchors.leftMargin: Style.spacing.lg
          anchors.rightMargin: Style.spacing.lg
          text: "! " + janela.textoFaixa(janela.arranjo.faixa)
          color: janela.corTexto
          font.family: janela.familia
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
        }

        Button {
          id: botaoCorrigir
          anchors.right: parent.right
          anchors.rightMargin: Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
          visible: janela.arranjo.faixa.vao === true && janela.arranjo.estado === "editando"
          text: janela.strings.t("corrigir")
          foreground: janela.corTexto
          bordered: true
          onClicked: {
            janela.arranjo.corrigirArranjo()
            teclas.forceActiveFocus()
          }
        }
      }

      PanelSeparator { foreground: janela.corTexto }

      DetalhesTela {
        width: parent.width
        arranjo: janela.arranjo
        strings: janela.strings
        painel: janela
        chave: janela.selecaoEfetiva
        onDevolverFoco: teclas.forceActiveFocus()
      }

      PanelSeparator { foreground: janela.corTexto }

      // Screens outside the arrangement (off or mirrored), owned by the Display panel.
      Column {
        width: parent.width
        spacing: Style.spacing.sm

        Text {
          textFormat: Text.PlainText
          width: parent.width
          text: janela.arranjo.fora.length === 0 ? janela.strings.t("fora.nenhuma") : janela.strings.t("fora.titulo")
          color: janela.corTexto
          font.family: janela.familia
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
        }

        Repeater {
          model: janela.arranjo.fora

          Text {
            required property var modelData
            textFormat: Text.PlainText
            width: parent.width
            text: janela.texto("fora.item", [janela.nomeCurto(modelData.desc, modelData.porta), modelData.porta])
            color: janela.corTexto
            font.family: janela.familia
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }
        }
      }

      // Undo and Apply; a disabled Apply says why.
      Item {
        width: parent.width
        height: Math.max(botaoAplicar.implicitHeight, motivoTexto.implicitHeight)

        Text {
          id: motivoTexto
          textFormat: Text.PlainText
          anchors.left: parent.left
          anchors.right: botaoDesfazer.left
          anchors.rightMargin: Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
          visible: !janela.arranjo.aplicarHabilitado && janela.arranjo.motivoAplicar !== ""
          text: janela.strings.t(janela.arranjo.motivoAplicar)
          color: Qt.darker(janela.corTexto, 1.4)
          font.family: janela.familia
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
          horizontalAlignment: Text.AlignRight
        }

        Button {
          id: botaoDesfazer
          anchors.right: botaoAplicar.left
          anchors.rightMargin: Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
          text: janela.strings.t("desfazer")
          foreground: janela.corTexto
          bordered: true
          enabled: janela.arranjo.estado === "editando" && Object.keys(janela.arranjo.edicoes).length > 0
          opacity: enabled ? 1 : janela.opacidadeDesabilitado
          onClicked: {
            janela.arranjo.desfazer()
            teclas.forceActiveFocus()
          }
        }

        Button {
          id: botaoAplicar
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
          text: janela.strings.t("aplicar")
          foreground: janela.corTexto
          bordered: true
          selected: janela.arranjo.aplicarHabilitado
          enabled: janela.arranjo.aplicarHabilitado
          opacity: enabled ? 1 : janela.opacidadeDesabilitado
          onClicked: {
            janela.arranjo.aplicar()
            teclas.forceActiveFocus()
          }
        }
      }
    }
  }
}
