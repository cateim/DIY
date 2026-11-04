-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

local omarchy_gdk_scale = 1
local omarchy_monitor_scale = 1

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })
-- Escalas fixas de propósito: o controle SCALE do painel reescreve omarchy_monitor_scale,
-- e se estas regras usassem a variável ele mudaria as duas telas juntas.
-- LG ultrawide na parede, acima do notebook (pela descrição, não pela porta HDMI-A-4).
-- Escala 1: ocupa 2560x1080 no layout.
hl.monitor({ output = "desc:LG Electronics LG ULTRAWIDE 0x0003B53D", mode = "2560x1080@75", position = "0x0", scale = 1 })
-- Alienware, logo abaixo do LG. Escala 1.25: ocupa 2048x1152 no layout.
-- y = 1080 (altura do LG); x = (2560 - 2048) / 2 = 256, centralizado sob o LG.
hl.monitor({ output = "eDP-1", mode = "2560x1440@120", position = "256x1080", scale = 1.25 })

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })
