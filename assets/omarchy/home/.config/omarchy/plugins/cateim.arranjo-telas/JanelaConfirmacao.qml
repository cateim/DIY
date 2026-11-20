import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// Confirmation after Aplicar, and the Esquecer question (spec 8.6, 8.10). A
// PanelWindow of its own, always on the laptop panel (D12), with exclusive
// keyboard focus while it shows; the panel lets go of the keyboard meanwhile.
// It maps only while a dialog is up, so it lands above the panel. Omarchy's
// ConfirmDialog does the drawing and the keys: Esc and a click on the scrim
// cancel (Reverter / Cancelar), and the first button is selected on every
// opening, so a blind Enter reverts. ConfirmDialog moves its selection on
// mouse hover; here only the keyboard moves it (selecaoTeclado), so the mouse
// resting over Manter never turns a blind Enter into Manter (spec 8.10).
PanelWindow {
  id: janela

  required property var arranjo
  required property var strings
  required property var painel

  readonly property string portaInterna: "eDP-1"
  readonly property int indiceSeguro: 0          // Reverter / Cancelar
  readonly property var teclasDeTroca: [Qt.Key_Left, Qt.Key_Right, Qt.Key_Tab, Qt.Key_Backtab]
  property int selecaoTeclado: janela.indiceSeguro

  readonly property bool confirmando: janela.arranjo.confirmacaoVisivel
  readonly property bool esquecendo: !janela.confirmando && janela.arranjo.dialogoEsquecer !== ""
  readonly property bool pedido: janela.confirmando || janela.esquecendo

  readonly property var telaFixa: {
    var telas = Quickshell.screens
    for (var i = 0; i < telas.length; i++) if (telas[i].name === janela.portaInterna) return telas[i]
    return telas.length > 0 ? telas[0] : null
  }

  readonly property string nomeEsquecer: {
    var chave = janela.arranjo.dialogoEsquecer
    var f = janela.arranjo.fantasmas
    for (var i = 0; i < f.length; i++) {
      if (f[i].chave === chave) return janela.painel.nomeCurto(f[i].desc, f[i].porta)
    }
    return chave
  }

  function abrir() {
    janela.selecaoTeclado = janela.indiceSeguro
    dialogo.selectedIndex = janela.indiceSeguro
    teclas.forceActiveFocus()
  }

  onConfirmandoChanged: if (janela.confirmando) janela.abrir()
  onEsquecendoChanged: if (janela.esquecendo) janela.abrir()
  onVisibleChanged: if (janela.visible) janela.abrir()

  visible: janela.pedido && janela.telaFixa !== null
  screen: janela.telaFixa
  anchors { top: true; left: true; bottom: true; right: true }
  color: "transparent"
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.namespace: "cateim-arranjo-telas-confirmacao"
  WlrLayershell.layer: WlrLayer.Overlay
  WlrLayershell.keyboardFocus: janela.pedido ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None

  Item {
    id: teclas
    anchors.fill: parent
    focus: true

    Keys.onPressed: function (event) {
      if (dialogo.opened && janela.teclasDeTroca.indexOf(event.key) >= 0) {
        janela.selecaoTeclado = janela.selecaoTeclado === 0 ? 1 : 0
        dialogo.selectedIndex = janela.selecaoTeclado
        event.accepted = true
        return
      }
      event.accepted = dialogo.handleKey(event)
    }

    ConfirmDialog {
      id: dialogo
      anchors.fill: parent
      opened: janela.pedido
      message: janela.confirmando
        ? janela.strings.t("confirmacao.pergunta") + "\n"
          + janela.strings.tn("confirmacao.contagem", janela.arranjo.segundosRestantes)
              .arg(Commons.I18n.formatNumber(janela.arranjo.segundosRestantes))
        : janela.painel.texto("esquecer.pergunta", [janela.nomeEsquecer])
      cancelText: janela.confirmando ? janela.strings.t("reverter") : janela.strings.t("cancelar")
      confirmText: janela.confirmando ? janela.strings.t("manter") : janela.strings.t("esquecer.confirmar")
      background: Commons.Color.menu.background
      foreground: Commons.Color.menu.text
      scrim: Commons.Color.menu.scrim
      selectedBackground: Commons.Color.menu.selectedBackground
      selectedText: Commons.Color.menu.selectedText
      fontFamily: Style.font.menuFamily

      // Hover sets selectedIndex inside ConfirmDialog; put the keyboard one back.
      onSelectedIndexChanged: if (dialogo.selectedIndex !== janela.selecaoTeclado) dialogo.selectedIndex = janela.selecaoTeclado

      onCanceled: {
        if (janela.confirmando) janela.arranjo.reverter()
        else if (janela.esquecendo) janela.arranjo.cancelarEsquecer()
      }
      onConfirmed: {
        if (janela.confirmando) janela.arranjo.manter()
        else if (janela.esquecendo) janela.arranjo.confirmarEsquecer()
      }
    }
  }
}
