import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "WindowSwitcherModel.js" as Model

// Alt+Tab with live thumbnails. Hyprland owns the keys through the
// `cateim-switcher` submap in ~/.config/hypr/bindings.lua and reports each one
// as hl.dsp.event("cateim-switcher>>next|prev|confirm|cancel"), which arrives
// here, in order, as the socket2 event `custom`. keepLoaded mounts this at shell
// start, so the focus order is tracked before the first Alt+Tab.
Item {
  id: root

  readonly property string eventPrefix: "cateim-switcher"
  readonly property string logTag: "[cateim.window-switcher]"
  // A quick Alt+Tab tap switches without flashing the overlay, like Windows.
  property int showDelay: 90

  property bool opened: false
  property bool shown: false
  property int selectedIndex: 0
  // Window addresses, most recently focused first (see WindowSwitcherModel.js).
  property var recency: []
  // The windows of the current session, in the order they are shown.
  property var order: []
  property var targetScreen: null

  // Same [menu] surface tokens as the built-in clipboard and menu, so the
  // active theme styles the switcher too.
  property color background: Commons.Color.menu.background
  property color foreground: Commons.Color.menu.text
  property color border: Commons.Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Commons.Color.menu.scrim
  property color selectedBackground: Commons.Color.menu.selectedBackground
  property color selectedText: Commons.Color.menu.selectedText
  property color hoverBackground: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.04)
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int tileSpacing: Style.spacing.lg
  property int tilePadding: Style.spacing.lg
  property int headerHeight: Math.max(Style.space(20), Style.font.body + Style.spacing.sm * 2)
  property int iconSize: Math.max(Style.space(16), Style.font.body + Style.spacing.sm)

  readonly property int screenWidth: targetScreen ? targetScreen.width : 1920
  readonly property int screenHeight: targetScreen ? targetScreen.height : 1080
  property int thumbHeight: Math.round(Math.min(Math.max(screenHeight * 0.16, 110), 200))
  property int thumbWidth: Math.round(thumbHeight * 16 / 10)
  readonly property int tileWidth: thumbWidth + tilePadding * 2
  readonly property int tileHeight: headerHeight + thumbHeight + tilePadding * 3
  readonly property int maxRowWidth: Math.round(screenWidth * 0.9) - contentMargin * 2
  readonly property int columns: Math.max(1, Math.min(order.length,
    Math.floor((maxRowWidth + tileSpacing) / (tileWidth + tileSpacing))))
  readonly property int rows: Math.max(1, Math.ceil(order.length / columns))

  // ---- Shell host contract ----
  // summon/toggle land here; the keyboard path never uses them.
  function open(payloadJson) { root.handle("next") }
  function close() { root.finish(true) }
  function toggle() {
    if (root.opened) root.close()
    else root.open("{}")
  }

  // Drives the switcher without a keyboard, for testing:
  //   omarchy-shell shell call cateim.window-switcher action next|prev|confirm|cancel
  function action(name) {
    root.handle(String(name || ""))
    return root.opened ? "open " + root.selectedIndex + "/" + root.order.length : "closed"
  }

  // What the switcher sees for each window, as JSON:
  //   omarchy-shell shell call cateim.window-switcher debugWindows ""
  function debugWindows() {
    var values = Hyprland.toplevels.values || []
    return JSON.stringify(values.map(function(toplevel) {
      return {
        address: Model.normalizeAddress(toplevel.address),
        title: String(toplevel.title || "").slice(0, 40),
        candidates: root.iconCandidates(toplevel),
        icon: root.iconFor(toplevel),
        hasWayland: !!toplevel.wayland,
        rank: root.recency.indexOf(Model.normalizeAddress(toplevel.address))
      }
    }))
  }

  // ---- Switcher ----
  function handle(name) {
    if (name === "next" || name === "prev") {
      var step = name === "next" ? 1 : -1
      if (!root.opened) root.begin(step)
      else root.selectedIndex = Model.stepIndex(root.selectedIndex, root.order.length, step)
    } else if (name === "confirm") {
      if (root.opened) root.activate(root.selectedIndex, false)
    } else if (name === "cancel") {
      root.finish(false)
    }
  }

  function begin(step) {
    var list = root.collectOrder()
    if (list.length === 0) return
    // Fills lastIpcObject (initialClass, initialTitle) for the icon lookup.
    Hyprland.refreshToplevels()
    root.order = list
    root.selectedIndex = Model.initialIndex(list.length, step)
    root.targetScreen = root.focusedScreen()
    root.opened = true
    showTimer.restart()
  }

  // fromPointer: a click ends the switcher while Hyprland is still in the
  // submap, so it has to leave it here. A key-driven confirm/cancel already
  // left it in the bind; resetting again could cut short a new Alt+Tab
  // started in the meantime.
  function activate(index, fromPointer) {
    var address = root.order[index]
    root.finish(fromPointer)
    if (!Model.isSafeAddress(address)) return
    Hyprland.dispatch('hl.dsp.focus({ window = "address:0x' + address + '" })')
  }

  function finish(resetSubmap) {
    var wasOpen = root.opened
    showTimer.stop()
    root.opened = false
    root.shown = false
    root.order = []
    if (wasOpen && resetSubmap) Hyprland.dispatch('hl.dsp.submap("reset")')
  }

  // Every window on every workspace and monitor, except the scratchpad, which
  // is hidden on purpose.
  function collectOrder() {
    var values = Hyprland.toplevels.values || []
    var list = []
    for (var i = 0; i < values.length; i++) {
      var toplevel = values[i]
      var workspace = toplevel.workspace
      if (workspace && String(workspace.name).indexOf("special:") === 0) continue
      list.push({ address: Model.normalizeAddress(toplevel.address) })
    }
    return Model.orderByRecency(list, root.recency).map(function(entry) { return entry.address })
  }

  function forget(address) {
    root.recency = Model.removeAddress(root.recency, address)
    if (!root.opened) return
    var kept = Model.removeAddress(root.order, address)
    if (kept.length === root.order.length) return
    if (kept.length === 0) {
      root.finish(true)
      return
    }
    root.order = kept
    root.selectedIndex = Math.min(root.selectedIndex, kept.length - 1)
  }

  function focusedScreen() {
    var monitor = Hyprland.focusedMonitor
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++) {
      if (monitor && screens[i].name === monitor.name) return screens[i]
    }
    return screens.length > 0 ? screens[0] : null
  }

  // Candidates for the icon, best first. Omarchy's agent terminals share the
  // class org.omarchy.agent, which has no desktop entry, and keep the terminal
  // name (e.g. "foot") only in initialTitle, so a one-word initialTitle counts.
  function iconCandidates(toplevel) {
    if (!toplevel) return []
    var ipc = toplevel.lastIpcObject || {}
    var out = []
    if (toplevel.wayland && toplevel.wayland.appId) out.push(String(toplevel.wayland.appId))
    if (ipc.class) out.push(String(ipc.class))
    if (ipc.initialClass) out.push(String(ipc.initialClass))
    if (ipc.initialTitle && String(ipc.initialTitle).indexOf(" ") < 0) out.push(String(ipc.initialTitle))
    return out
  }

  function iconFor(toplevel) {
    var candidates = root.iconCandidates(toplevel)
    for (var i = 0; i < candidates.length; i++) {
      var entry = DesktopEntries.heuristicLookup(candidates[i])
      var path = entry && entry.icon ? Quickshell.iconPath(entry.icon, true) : ""
      if (path) return path
    }
    for (var j = 0; j < candidates.length; j++) {
      var themed = Quickshell.iconPath(candidates[j].toLowerCase(), true)
      if (themed) return themed
    }
    return Quickshell.iconPath("application-x-executable", true)
  }

  Connections {
    target: Hyprland

    function onRawEvent(event) {
      if (event.name === "activewindowv2") {
        root.recency = Model.moveToFront(root.recency, event.data)
      } else if (event.name === "closewindow") {
        root.forget(event.data)
      } else if (event.name === "custom") {
        var name = Model.switcherAction(event.data, root.eventPrefix)
        if (name) root.handle(name)
      }
    }
  }

  // Focus order from before the shell started; live events take over from here.
  Process {
    id: seedProc
    running: true
    command: ["hyprctl", "clients", "-j"]
    stdout: StdioCollector {
      onStreamFinished: {
        try {
          root.recency = Model.mergeRecency(root.recency, Model.seedFromClients(JSON.parse(text)))
        } catch (e) {
          console.warn(root.logTag, "could not read hyprctl clients:", e)
        }
      }
    }
  }

  Component.onCompleted: Hyprland.refreshToplevels()

  Timer {
    id: showTimer
    interval: root.showDelay
    repeat: false
    onTriggered: if (root.opened) root.shown = true
  }

  PanelWindow {
    id: panel
    screen: root.targetScreen
    visible: root.shown && root.targetScreen !== null
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "cateim-window-switcher"
    WlrLayershell.layer: WlrLayer.Overlay
    // The submap owns Tab, Esc and the Alt release. Taking keyboard focus here
    // would only pull it away from the window being left.
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.finish(true)
    }

    BorderSurface {
      id: card
      anchors.centerIn: parent
      width: tiles.width + card.contentLeftInset + card.contentRightInset
      height: tiles.height + card.contentTopInset + card.contentBottomInset
      radius: root.cornerRadius
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: tiles
        x: card.contentLeftInset
        y: card.contentTopInset
        width: root.columns * root.tileWidth + (root.columns - 1) * root.tileSpacing
        height: root.rows * root.tileHeight + (root.rows - 1) * root.tileSpacing

        // One tile per window for as long as the window exists, placed by its
        // rank in the session instead of being rebuilt in that order. Hyprland
        // only hands out a frame while the window is on a monitor (an off-screen
        // column in the scrolling layout waits), so a tile that lives on keeps
        // the last frame it got for the next Alt+Tab.
        Repeater {
          model: Hyprland.toplevels

          delegate: Rectangle {
            id: tile

            required property var modelData
            readonly property var toplevel: modelData
            readonly property string address: Model.normalizeAddress(modelData ? modelData.address : "")
            readonly property int rank: root.order.indexOf(address)
            readonly property bool selected: rank >= 0 && rank === root.selectedIndex

            visible: rank >= 0
            x: rank < 0 ? 0 : (rank % root.columns) * (root.tileWidth + root.tileSpacing)
            y: rank < 0 ? 0 : Math.floor(rank / root.columns) * (root.tileHeight + root.tileSpacing)
            width: root.tileWidth
            height: root.tileHeight
            radius: root.cornerRadius
            color: selected ? root.selectedBackground : (pointer.containsMouse ? root.hoverBackground : "transparent")
            border.width: selected ? Math.max(1, Style.space(2)) : 0
            border.color: root.selectedText

            Row {
              id: header
              x: root.tilePadding
              y: root.tilePadding
              width: root.thumbWidth
              height: root.headerHeight
              spacing: Style.spacing.md

              Image {
                anchors.verticalCenter: parent.verticalCenter
                width: root.iconSize
                height: root.iconSize
                sourceSize: Qt.size(root.iconSize * 2, root.iconSize * 2)
                source: root.iconFor(tile.toplevel)
                fillMode: Image.PreserveAspectFit
                asynchronous: true
              }

              Text {
                anchors.verticalCenter: parent.verticalCenter
                width: header.width - root.iconSize - header.spacing
                text: tile.toplevel ? tile.toplevel.title : ""
                color: tile.selected ? root.selectedText : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }
            }

            Item {
              x: root.tilePadding
              y: header.y + header.height + root.tilePadding
              width: root.thumbWidth
              height: root.thumbHeight

              ScreencopyView {
                id: thumb
                readonly property var fitted: Model.fitSize(sourceSize.width, sourceSize.height, root.thumbWidth, root.thumbHeight)
                anchors.centerIn: parent
                width: fitted.width
                height: fitted.height
                // Bound for the tile's whole life, not only while shown: the
                // first frame then lands as soon as the window is on screen.
                captureSource: tile.toplevel ? tile.toplevel.wayland : null
                live: root.shown && tile.visible
                visible: hasContent
              }

              // No frame yet (the window has not been on a monitor since this
              // tile appeared): show the app icon.
              Image {
                anchors.centerIn: parent
                visible: !thumb.hasContent
                width: Math.round(root.thumbHeight * 0.4)
                height: width
                sourceSize: Qt.size(width * 2, height * 2)
                source: root.iconFor(tile.toplevel)
                fillMode: Image.PreserveAspectFit
                asynchronous: true
              }
            }

            MouseArea {
              id: pointer
              anchors.fill: parent
              hoverEnabled: true
              onClicked: root.activate(tile.rank, true)
            }
          }
        }
      }
    }
  }
}
