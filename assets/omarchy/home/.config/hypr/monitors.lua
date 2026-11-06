-- See https://wiki.hypr.land/Configuring/Basics/Monitors/
-- List current monitors and supported resolutions with: hyprctl monitors all

local omarchy_gdk_scale = 1
local omarchy_monitor_scale = 1

hl.env("GDK_SCALE", tostring(omarchy_gdk_scale))
hl.monitor({ output = "", mode = "preferred", position = "auto", scale = omarchy_monitor_scale })
-- Escalas fixas por tela: Alienware 1.25 e LG 1. As duas variáveis acima são do controle de
-- escala do Omarchy: omarchy_monitor_scale só vale para tela sem regra própria, e desde a 4.5
-- o comando grava a escala na regra com o nome da tela e põe em omarchy_gdk_scale a menor
-- escala arredondada (aqui 1). Com 2, os apps GTK do XWayland abrem com o dobro do tamanho.
-- O Alienware fica na origem 0x0 de propósito: o xdg-desktop-portal-hyprland informa toda
-- tela compartilhada na posição (0,0) (src/portals/Screencopy.cpp), e o RustDesk usa essa
-- posição para mirar o mouse. Com o eDP-1 em outro ponto, o cursor remoto caía no LG
-- (rustdesk#15731). O arranjo físico é o mesmo de antes, só a origem mudou.
-- Alienware. Escala 1.25: ocupa 2048x1152 no layout.
hl.monitor({ output = "eDP-1", mode = "2560x1440@120", position = "0x0", scale = 1.25 })
-- LG ultrawide na parede, acima do notebook (pela descrição, não pela porta HDMI-A-4).
-- Escala 1: ocupa 2560x1080. y = -1080 (altura do LG); x = -(2560 - 2048) / 2 = -256,
-- centralizado sobre o Alienware.
-- Durante uma sessão do RustDesk o LG fica desligado pelo ~/.local/bin/rustdesk-tela-unica
-- (serviço de usuário rustdesk-tela-unica): com duas telas, o cliente web erra o mouse. No fim
-- da sessão ele roda hyprctl reload, que relê este arquivo e religa o LG daqui.
hl.monitor({ output = "desc:LG Electronics LG ULTRAWIDE 0x0003B53D", mode = "2560x1080@75", position = "-256x-1080", scale = 1 })
-- O mesmo LG pelo nome da porta, para o painel Display. Desde o Omarchy 4.5 o painel liga e
-- desliga uma tela pelo nome (hl.monitor com output = "HDMI-A-4" e só disabled; Panel.qml,
-- toggleDisplay) e mantém modo, posição e escala da regra que já tem esse nome. Sem esta regra
-- ele criava uma vazia e o LG voltava à direita, a 60 Hz. A regra pela descrição continua
-- valendo se a porta mudar de nome. Testado em 05/11/2026: desligar pelo serviço ou pelo painel
-- e ligar pelo painel volta em -256x-1080 a 75 Hz. O vigia-omarchy avisa se o painel mudar.
hl.monitor({ output = "HDMI-A-4", mode = "2560x1080@75", position = "-256x-1080", scale = 1 })

-- Configure a specific monitor.
-- hl.monitor({ output = "DP-2", mode = "2560x1440@144", position = "0x0", scale = 1 })

-- Portrait/rotated secondary monitor (transform: 1 = 90°, 3 = 270°).
-- hl.monitor({ output = "DP-2", mode = "preferred", position = "auto", scale = 1, transform = 1 })
