-- Keep only your personal keybinding overrides here. Add new bindings or
-- unbind defaults before replacing them.

-- See current bindings and descriptions:
--   omarchy menu keybindings --print

-- To disable every Omarchy default binding, set this in
-- ~/.config/hypr/hyprland.lua before require("default.hypr.omarchy"), then add
-- only the bindings you want below:
--   omarchy_default_bindings = false

-- To disable all preinstalled app/webapp bindings, set:
--   omarchy_preinstalled_bindings = false

-- Add a new binding.
-- o.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh your-server")

-- Change an existing binding by unbinding it first, then binding the key again.
-- This example changes SUPER+SPACE from the launcher to the Omarchy root menu.
-- hl.unbind("SUPER + SPACE")
-- o.bind("SUPER + SPACE", "Omarchy menu", "omarchy-menu toggle root")

-- Disable a default binding without replacing it.
-- hl.unbind("SUPER + SHIFT + B")

-- Logitech MX Keys examples:
-- o.bind("SUPER + SHIFT + S", nil, "omarchy-capture-screenshot")
-- o.bind("SUPER + H", nil, "voxtype record toggle")
-- o.bind("SUPER + PERIOD", nil, "omarchy-shell shell toggle omarchy.emojis")

-- Gerenciador de arquivos, igual ao Win + E do Windows
o.bind("SUPER + E", "File manager", { omarchy = "nautilus" })

-- HEY removido em 02/11/2026: as teclas de e-mail e agenda que abriam o app.hey.com
-- passam a abrir o Gmail e o Google Agenda. Super+Shift+Alt+E (novo e-mail do HEY) fica solta.
hl.unbind("SUPER + SHIFT + C")
hl.unbind("SUPER + SHIFT + E")
hl.unbind("SUPER + SHIFT + ALT + E")
o.bind("SUPER + SHIFT + E", "Email", { webapp = "https://mail.google.com" })
o.bind("SUPER + SHIFT + C", "Calendar", { webapp = "https://calendar.google.com" })

-- Atalhos do Windows, adicionados em 02/11/2026:
-- Super+H abre o histórico da área de transferência (tecla estava livre). Super+V fica
-- com o Universal paste do Omarchy, e Super+Ctrl+V continua abrindo o histórico também.
-- Super+Shift+S tira screenshot de uma região, como o Win+Shift+S (era: Google Maps).
o.bind("SUPER + H", "Clipboard manager", "omarchy-shell shell toggle omarchy.clipboard")
hl.unbind("SUPER + SHIFT + S")
o.bind("SUPER + SHIFT + S", "Screenshot", "omarchy-capture-screenshot")

-- VNC, adicionado em 02/11/2026: Ctrl+Shift+F12 troca o monitor que o wayvnc transmite
-- (notebook <-> LG). Sem Super de propósito, porque pelo navegador num Windows a tecla
-- Win fica com o próprio Windows. Pelo VNC, aperte no teclado do PC remoto.
o.bind("CTRL + SHIFT + F12", "Switch VNC monitor", os.getenv("HOME") .. "/.local/bin/vnc-trocar-tela")

-- Mover a janela ativa para o outro monitor, adicionado em 03/11/2026 (o Omarchy só move
-- o workspace inteiro). Setas para cima/baixo porque o LG fica em cima do notebook.
-- Super+Ctrl+Up/Down estavam livres; Super+Ctrl+Left/Right seguem com os grupos.
o.bind("SUPER + CTRL + UP", "Move window to monitor above", hl.dsp.window.move({ monitor = "u" }))
o.bind("SUPER + CTRL + DOWN", "Move window to monitor below", hl.dsp.window.move({ monitor = "d" }))

-- Igualar janelas, adicionado em 06/11/2026: SUPER + SHIFT + J deixa as colunas do
-- workspace com a mesma largura e as linhas com a mesma altura, no layout tiling
-- (dwindle). A tecla estava livre e fica ao lado do SUPER + J (Toggle window split).
-- Como funciona e o limite: ~/.config/hypr/igualar-janelas.lua.
o.bind("SUPER + SHIFT + J", "Equalize windows", require("hypr.igualar-janelas").equalize_workspace)

-- Alt+Tab com miniaturas (plugin ~/.config/omarchy/plugins/cateim.window-switcher),
-- adicionado em 03/11/2026. Substitui o Alt+Tab do Omarchy (era: focar a próxima
-- janela e trazê-la para frente). O Hyprland segura as teclas no submap
-- "cateim-switcher" e avisa o plugin por evento no socket2
-- (custom>>cateim-switcher>>ação), que chega em ordem e sem criar processo.
-- Soltar o Alt sempre sai do submap, mesmo com o shell fora do ar.
-- Preso no submap? hyprctl dispatch 'hl.dsp.submap("reset")'
local SWITCHER_SUBMAP = "cateim-switcher"

-- Janelas que ficam com o próprio Alt+Tab: no Windows VM (xfreerdp) ele troca
-- as janelas do Windows. Para sair da VM pelo teclado, use os atalhos com Super.
local SWITCHER_PASSTHROUGH = { xfreerdp = true }

local function switcher_event(action)
  hl.dispatch(hl.dsp.event("cateim-switcher>>" .. action))
end

local function switcher_open(action)
  return function()
    local window = hl.get_active_window()
    if window and SWITCHER_PASSTHROUGH[window.class] then
      -- pass_event entrega o Tab à janela em vez de consumi-lo; o Tab solto
      -- segue o mesmo caminho (Hyprland 0.56.2, KeybindManager.cpp:409 e :422).
      return { pass_event = true }
    end
    switcher_event(action)
    hl.dispatch(hl.dsp.submap(SWITCHER_SUBMAP))
  end
end

local function switcher_close(action)
  return function()
    if hl.get_current_submap() ~= SWITCHER_SUBMAP then return end
    switcher_event(action)
    hl.dispatch(hl.dsp.submap("reset"))
  end
end

hl.unbind("ALT + TAB")
hl.unbind("ALT + SHIFT + TAB")
o.bind("ALT + TAB", "Window switcher", switcher_open("next"))
o.bind("ALT + SHIFT + TAB", "Window switcher (previous)", switcher_open("prev"))

-- Soltar o Alt confirma. Fica fora do submap, com submap_universal, porque o
-- Hyprland casa o "soltar" com o submap de quando a tecla foi APERTADA
-- (KeybindManager.cpp:652), e o Alt é apertado antes de o submap abrir.
-- non_consuming é obrigatório: sem ele, todo Alt apertado em qualquer app seria
-- engolido (KeybindManager.cpp:728). transparent também: quando o Tab é consumido,
-- o Hyprland sombreia os binds de teclas ainda pressionadas, o Alt entre elas, e
-- bind sombreado não dispara (shadowKeybinds, KeybindManager.cpp:855-899 e :652).
-- Fora do switcher, switcher_close não faz nada.
hl.bind("Alt_L", switcher_close("confirm"), { release = true, ignore_mods = true, non_consuming = true, submap_universal = true, transparent = true })
hl.bind("Alt_R", switcher_close("confirm"), { release = true, ignore_mods = true, non_consuming = true, submap_universal = true, transparent = true })

hl.define_submap(SWITCHER_SUBMAP, function()
  hl.bind("ALT + TAB", function() switcher_event("next") end, { repeating = true })
  hl.bind("ALT + SHIFT + TAB", function() switcher_event("prev") end, { repeating = true })
  hl.bind("Escape", switcher_close("cancel"), { ignore_mods = true })
end)

-- Dictation keys from before Alt + Space and Right Alt became the defaults.
-- Remove these lines to give the keys back to applications.
if o.dictation_installed and o.dictation_installed() then
  o.bind("SUPER + CTRL + X", "Toggle dictation", "omarchy-dictation toggle")
  o.bind_hold("F9", "Start dictation (push-to-talk)", "omarchy-dictation start", "Stop dictation (push-to-talk)", "omarchy-dictation stop")
end
