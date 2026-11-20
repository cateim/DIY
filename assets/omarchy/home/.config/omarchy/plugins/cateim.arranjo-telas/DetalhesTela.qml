import QtQuick
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Geometria.js" as Geo

// Details of the selected screen (spec 8.10), in four shapes:
//   external with a rule: Resolution and Orientation menus, scale, size and
//     position read-only. Omarchy's Dropdown has no disabled option, so an
//     incompatible mode is labelled with modo.incompativel; choosing it is
//     refused by the root, the menu snaps back and the band explains;
//   laptop panel: text only (D12);
//   external without a rule: the D11 band text and "focus this screen" (S4);
//   ghost: saved place and mode, and "forget this screen" (S2).
Column {
  id: detalhes

  required property var arranjo
  required property var strings
  required property var painel
  property string chave: ""

  // Hands the keyboard back to the panel after a menu choice or a button.
  signal devolverFoco()

  readonly property int larguraRotulo: Style.space(170)
  readonly property int larguraMenu: Style.space(300)
  readonly property var orientacoes: [0, 1, 2, 3]

  readonly property var tela: {
    var a = detalhes.arranjo.alvo
    for (var i = 0; i < a.length; i++) if (a[i].porta === detalhes.chave) return a[i]
    return null
  }
  readonly property var fantasma: {
    if (detalhes.tela !== null) return null
    var f = detalhes.arranjo.fantasmas
    for (var i = 0; i < f.length; i++) if (f[i].chave === detalhes.chave) return f[i]
    return null
  }
  readonly property string forma: detalhes.fantasma !== null ? "fantasma"
                                  : detalhes.tela === null ? ""
                                  : detalhes.tela.interna ? "notebook"
                                  : detalhes.arranjo.semRegra.indexOf(detalhes.tela.porta) >= 0 ? "semRegra"
                                  : "externa"
  readonly property bool editavel: detalhes.arranjo.estado === "editando" && detalhes.arranjo.dialogoEsquecer === ""
  readonly property bool difere: {
    if (detalhes.tela === null) return false
    var d = detalhes.arranjo.diferencasAtuais
    for (var i = 0; i < d.length; i++) if (d[i].porta === detalhes.tela.porta) return true
    return false
  }

  readonly property var modos: detalhes.tela !== null ? Geo.modosCompativeis(detalhes.tela.modos, detalhes.tela.escala) : []
  readonly property var opcoesModo: {
    var saida = []
    var escala = detalhes.tela !== null ? detalhes.painel.numero(detalhes.tela.escala) : ""
    for (var i = 0; i < detalhes.modos.length; i++) {
      var m = detalhes.modos[i]
      var rotulo = detalhes.painel.rotuloModo(m.modo)
      saida.push({ value: m.modo,
                   label: m.compativel ? rotulo : detalhes.painel.texto("modo.incompativel", [rotulo, escala]) })
    }
    return saida
  }
  readonly property var opcoesOrientacao: detalhes.orientacoes.map(function (t) {
    return { value: String(t), label: detalhes.strings.t("orientacao." + t) }
  })

  spacing: Style.spacing.md

  // Header: short name and port, and the per-screen mark.
  Item {
    width: parent.width
    height: cabecalho.implicitHeight
    visible: detalhes.forma !== ""

    Text {
      id: cabecalho
      textFormat: Text.PlainText
      anchors.left: parent.left
      anchors.right: marca.visible ? marca.left : parent.right
      text: {
        var r = detalhes.tela !== null ? detalhes.tela : detalhes.fantasma
        if (r === null) return ""
        return detalhes.painel.texto("tela.titulo", [detalhes.painel.nomeCurto(r.desc, r.porta), r.porta])
      }
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.subtitle
      font.bold: true
      elide: Text.ElideRight
    }

    Text {
      id: marca
      textFormat: Text.PlainText
      anchors.right: parent.right
      visible: detalhes.difere
      text: "* " + detalhes.strings.t("diferente.tela")
      color: detalhes.painel.corSelecionadaTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.bodySmall
    }
  }

  // ---- External screen with a rule ----

  Row {
    visible: detalhes.forma === "externa"
    spacing: Style.spacing.lg

    Text {
      textFormat: Text.PlainText
      width: detalhes.larguraRotulo
      anchors.verticalCenter: parent.verticalCenter
      text: detalhes.strings.t("resolucao")
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }

    Dropdown {
      id: menuModo
      width: detalhes.larguraMenu
      showLabel: false
      options: detalhes.opcoesModo
      value: detalhes.tela !== null ? detalhes.tela.modo : ""
      enabled: detalhes.editavel && detalhes.tela !== null && detalhes.tela.movel === true
      opacity: enabled ? 1 : detalhes.painel.opacidadeDesabilitado
      onChanged: function (v) {
        // The root refuses an incompatible mode and raises modo.recusado.
        if (detalhes.tela !== null && v !== detalhes.tela.modo) detalhes.arranjo.trocarModo(detalhes.tela.porta, v)
        menuModo.value = Qt.binding(function () { return detalhes.tela !== null ? detalhes.tela.modo : "" })
        detalhes.devolverFoco()
      }
    }
  }

  Row {
    visible: detalhes.forma === "externa"
    spacing: Style.spacing.lg

    Text {
      textFormat: Text.PlainText
      width: detalhes.larguraRotulo
      anchors.verticalCenter: parent.verticalCenter
      text: detalhes.strings.t("orientacao")
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }

    Dropdown {
      id: menuOrientacao
      width: detalhes.larguraMenu
      showLabel: false
      options: detalhes.opcoesOrientacao
      value: detalhes.tela !== null ? String(detalhes.tela.transform) : ""
      enabled: detalhes.editavel && detalhes.tela !== null && detalhes.tela.movel === true
      opacity: enabled ? 1 : detalhes.painel.opacidadeDesabilitado
      onChanged: function (v) {
        if (detalhes.tela !== null && Number(v) !== detalhes.tela.transform)
          detalhes.arranjo.trocarOrientacao(detalhes.tela.porta, Number(v))
        menuOrientacao.value = Qt.binding(function () { return detalhes.tela !== null ? String(detalhes.tela.transform) : "" })
        detalhes.devolverFoco()
      }
    }
  }

  Row {
    visible: detalhes.forma === "externa"
    spacing: Style.spacing.lg

    Text {
      textFormat: Text.PlainText
      width: detalhes.larguraRotulo
      text: detalhes.strings.t("escala.rotulo")
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }

    Text {
      textFormat: Text.PlainText
      // spec 8.5: a fractional logical size is marked "escala fora do padrão"
      text: detalhes.tela === null ? ""
        : detalhes.painel.texto("escala.somenteLeitura", [detalhes.painel.numero(detalhes.tela.escala)])
          + (detalhes.tela.fracionaria === true ? "; " + detalhes.strings.t("escala.foraDoPadrao") : "")
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }
  }

  Row {
    visible: detalhes.forma === "externa"
    spacing: Style.spacing.lg

    Text {
      textFormat: Text.PlainText
      width: detalhes.larguraRotulo
      text: detalhes.strings.t("arranjo.rotulo")
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }

    Text {
      textFormat: Text.PlainText
      text: detalhes.tela === null ? "" : detalhes.painel.texto("arranjo.tamanho", [
        detalhes.painel.numero(detalhes.tela.logW), detalhes.painel.numero(detalhes.tela.logH),
        detalhes.painel.numero(detalhes.tela.x), detalhes.painel.numero(detalhes.tela.y)])
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }
  }

  // ---- Laptop panel: text only ----

  Text {
    textFormat: Text.PlainText
    width: parent.width
    visible: detalhes.forma === "notebook"
    wrapMode: Text.WordWrap
    text: detalhes.tela === null ? "" : detalhes.painel.texto("notebook.somenteLeitura", [
      detalhes.tela.w, detalhes.tela.h, detalhes.painel.numero(detalhes.tela.hz), detalhes.painel.numero(detalhes.tela.escala)])
    color: detalhes.painel.corTexto
    font.family: detalhes.painel.familia
    font.pixelSize: Style.font.body
  }

  // ---- External screen without a rule (D11, S4) ----

  Text {
    textFormat: Text.PlainText
    width: parent.width
    visible: detalhes.forma === "semRegra"
    wrapMode: Text.WordWrap
    text: detalhes.strings.t("faixa.semRegra")
    color: detalhes.painel.corTexto
    font.family: detalhes.painel.familia
    font.pixelSize: Style.font.body
  }

  Button {
    visible: detalhes.forma === "semRegra"
    text: detalhes.strings.t("focar")
    foreground: detalhes.painel.corTexto
    bordered: true
    onClicked: {
      if (detalhes.tela !== null) detalhes.arranjo.focarTela(detalhes.tela.porta)
      detalhes.devolverFoco()
    }
  }

  // ---- Ghost (S2) ----

  Text {
    textFormat: Text.PlainText
    width: parent.width
    visible: detalhes.forma === "fantasma"
    wrapMode: Text.WordWrap
    // spec 8.5 and D14: a ghost drawn at the fallback scale says so
    text: detalhes.fantasma === null ? "" : detalhes.painel.texto("fantasma.descricao", [
      detalhes.painel.nomeCurto(detalhes.fantasma.desc, detalhes.fantasma.porta),
      detalhes.painel.numero(detalhes.fantasma.x), detalhes.painel.numero(detalhes.fantasma.y)])
      + (detalhes.fantasma.aproximada === true ? " " + detalhes.strings.t("fantasma.aproximada") : "")
    color: detalhes.painel.corTexto
    font.family: detalhes.painel.familia
    font.pixelSize: Style.font.body
  }

  Row {
    visible: detalhes.forma === "fantasma"
    spacing: Style.spacing.lg

    Text {
      textFormat: Text.PlainText
      width: detalhes.larguraRotulo
      text: detalhes.strings.t("resolucao")
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }

    Text {
      textFormat: Text.PlainText
      text: detalhes.fantasma === null ? "" : detalhes.painel.rotuloModo(detalhes.fantasma.modo)
      color: detalhes.painel.corTexto
      font.family: detalhes.painel.familia
      font.pixelSize: Style.font.body
    }
  }

  Button {
    visible: detalhes.forma === "fantasma"
    text: detalhes.strings.t("esquecer.botao")
    foreground: detalhes.painel.corTexto
    bordered: true
    enabled: detalhes.editavel
    opacity: enabled ? 1 : detalhes.painel.opacidadeDesabilitado
    onClicked: {
      if (detalhes.fantasma !== null) detalhes.arranjo.pedirEsquecer(detalhes.fantasma.chave)
    }
  }
}
