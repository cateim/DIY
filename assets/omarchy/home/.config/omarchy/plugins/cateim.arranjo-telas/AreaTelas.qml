import QtQuick
import qs.Commons
import qs.Commons as Commons

// The screens, drawn to scale (spec 8.10, "Área das telas"). One factor `k`
// fits every screen, ghosts included. The laptop panel is "Notebook" and never
// moves; ghosts are translucent and never move; a screen on a port without a
// rule gets a warning outline and never moves. Dragging divides the pointer
// by `k` and goes through the root's `arrastar` (Geo.encaixar with
// Geo.LIMIAR_ENCAIXE / k); releasing calls `soltarTela`, and the screen then
// slides to its final spot.
Item {
  id: area

  required property var arranjo
  required property var strings
  required property var painel
  property string selecionada: ""

  readonly property int margem: Style.space(16)
  readonly property int msAnimacao: 180
  readonly property real opacidadeFantasma: 0.45
  readonly property real kMinimo: 0.01
  readonly property real alfaFundo: 0.06

  clip: true

  // Every rectangle to fit: the live screens with the edits, and the ghosts.
  readonly property var caixa: {
    var lista = area.arranjo.alvo.concat(area.arranjo.fantasmas)
    if (lista.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (var i = 0; i < lista.length; i++) {
      var r = lista[i]
      x0 = Math.min(x0, r.x)
      y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.logW)
      y1 = Math.max(y1, r.y + r.logH)
    }
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
  }
  readonly property real k: Math.max(area.kMinimo, Math.min((area.width - 2 * area.margem) / area.caixa.w,
                                                            (area.height - 2 * area.margem) / area.caixa.h))
  readonly property real ox: (area.width - area.caixa.w * area.k) / 2 - area.caixa.x * area.k
  readonly property real oy: (area.height - area.caixa.h * area.k) / 2 - area.caixa.y * area.k

  onKChanged: area.arranjo.escalaDesenho = area.k
  Component.onCompleted: area.arranjo.escalaDesenho = area.k

  // A string model only changes when the set of keys does, so a delegate
  // (and its slide animation) survives every edit. Ghosts first: live
  // screens are drawn on top of them.
  readonly property string assinatura: {
    var chaves = []
    var f = area.arranjo.fantasmas
    for (var i = 0; i < f.length; i++) chaves.push(f[i].chave)
    var a = area.arranjo.alvo
    for (var j = 0; j < a.length; j++) chaves.push(a[j].porta)
    return chaves.join("\n")
  }

  function telaDe(chave) {
    var a = area.arranjo.alvo
    for (var i = 0; i < a.length; i++) if (a[i].porta === chave) return a[i]
    return null
  }

  function fantasmaDe(chave) {
    var f = area.arranjo.fantasmas
    for (var i = 0; i < f.length; i++) if (f[i].chave === chave) return f[i]
    return null
  }

  function difere(porta) {
    var d = area.arranjo.diferencasAtuais
    for (var i = 0; i < d.length; i++) if (d[i].porta === porta) return true
    return false
  }

  Repeater {
    model: area.assinatura === "" ? [] : area.assinatura.split("\n")

    delegate: Rectangle {
      id: bloco

      required property string modelData
      readonly property var tela: area.telaDe(modelData)
      readonly property var fantasma: bloco.tela === null ? area.fantasmaDe(modelData) : null
      readonly property var r: bloco.tela !== null ? bloco.tela : bloco.fantasma
      readonly property bool ehFantasma: bloco.tela === null
      readonly property bool semRegra: bloco.tela !== null && area.arranjo.semRegra.indexOf(bloco.tela.porta) >= 0
      readonly property bool movel: bloco.tela !== null && bloco.tela.movel === true && area.arranjo.estado === "editando"
      readonly property bool selecionado: area.selecionada === modelData
      property bool arrastando: false
      readonly property var arrasto: area.arranjo.arrasto
      readonly property bool usaArrasto: bloco.arrastando && bloco.arrasto !== null && bloco.arrasto.porta === modelData
      readonly property real lx: bloco.usaArrasto ? bloco.arrasto.x : (bloco.r !== null ? bloco.r.x : 0)
      readonly property real ly: bloco.usaArrasto ? bloco.arrasto.y : (bloco.r !== null ? bloco.r.y : 0)

      visible: bloco.r !== null
      x: area.ox + bloco.lx * area.k
      y: area.oy + bloco.ly * area.k
      width: bloco.r !== null ? bloco.r.logW * area.k : 0
      height: bloco.r !== null ? bloco.r.logH * area.k : 0
      z: bloco.arrastando ? 2 : (bloco.ehFantasma ? 0 : 1)
      clip: true
      radius: Style.cornerRadius
      opacity: bloco.ehFantasma ? area.opacidadeFantasma : 1
      color: bloco.selecionado ? area.painel.corSelecionadaFundo
             : Qt.rgba(area.painel.corTexto.r, area.painel.corTexto.g, area.painel.corTexto.b, area.alfaFundo)
      border.width: Math.max(1, Style.space(bloco.selecionado || bloco.semRegra ? 2 : 1))
      border.color: bloco.semRegra ? area.painel.corAviso
                    : (bloco.selecionado ? area.painel.corSelecionadaTexto : area.painel.corBorda)

      Behavior on x {
        enabled: !bloco.arrastando
        NumberAnimation { duration: Style.duration(area.msAnimacao); easing.type: Easing.OutCubic }
      }
      Behavior on y {
        enabled: !bloco.arrastando
        NumberAnimation { duration: Style.duration(area.msAnimacao); easing.type: Easing.OutCubic }
      }

      Column {
        anchors.centerIn: parent
        width: parent.width - Style.spacing.lg * 2
        spacing: Style.spacing.xxs

        Text {
          textFormat: Text.PlainText
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          text: bloco.r !== null ? area.painel.nomeCurto(bloco.r.desc, bloco.r.porta) : ""
          color: bloco.selecionado ? area.painel.corSelecionadaTexto : area.painel.corTexto
          font.family: area.painel.familia
          font.pixelSize: Style.font.bodySmall
          font.bold: true
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          text: bloco.r !== null ? String(bloco.r.porta) : ""
          color: area.painel.corTexto
          font.family: area.painel.familia
          font.pixelSize: Style.font.caption
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          text: bloco.r !== null ? area.painel.rotuloTamanho(bloco.r.modo) : ""
          color: area.painel.corTexto
          font.family: area.painel.familia
          font.pixelSize: Style.font.caption
        }

        Text {
          textFormat: Text.PlainText
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          elide: Text.ElideRight
          visible: bloco.tela !== null && area.difere(bloco.tela.porta)
          text: "* " + area.strings.t("diferente.tela")
          color: area.painel.corSelecionadaTexto
          font.family: area.painel.familia
          font.pixelSize: Style.font.caption
        }
      }

      MouseArea {
        id: ponteiro
        anchors.fill: parent
        cursorShape: bloco.movel ? Qt.OpenHandCursor : Qt.PointingHandCursor
        property real inicioX: 0
        property real inicioY: 0
        property real origemX: 0
        property real origemY: 0

        onPressed: function (mouse) {
          area.arranjo.selecionar(bloco.modelData)
          if (!bloco.movel || bloco.r === null) return
          var p = ponteiro.mapToItem(area, mouse.x, mouse.y)
          ponteiro.inicioX = p.x
          ponteiro.inicioY = p.y
          ponteiro.origemX = bloco.r.x
          ponteiro.origemY = bloco.r.y
          bloco.arrastando = true
        }

        onPositionChanged: function (mouse) {
          if (!bloco.arrastando) return
          var p = ponteiro.mapToItem(area, mouse.x, mouse.y)
          area.arranjo.arrastar(bloco.modelData,
                                Math.round(ponteiro.origemX + (p.x - ponteiro.inicioX) / area.k),
                                Math.round(ponteiro.origemY + (p.y - ponteiro.inicioY) / area.k))
        }

        onReleased: {
          if (!bloco.arrastando) return
          var a = bloco.arrasto
          var moveu = a !== null && a.porta === bloco.modelData && (a.x !== ponteiro.origemX || a.y !== ponteiro.origemY)
          // Animation back on before the drop, so the slide to the final spot shows.
          bloco.arrastando = false
          if (moveu) area.arranjo.soltarTela(bloco.modelData, a.x, a.y)
        }

        onCanceled: bloco.arrastando = false
      }
    }
  }
}
