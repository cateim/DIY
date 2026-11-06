-- Igualar as janelas do workspace ativo (SUPER + SHIFT + J no bindings.lua),
-- adicionado em 06/11/2026.
--
-- O dwindle não tem comando para igualar: cada janela nova divide a do foco ao
-- meio, então 3 janelas lado a lado ficam em 50/25/25. Aqui as colunas ficam com
-- a mesma largura e as linhas com a mesma altura.
--
-- O Hyprland não expõe a árvore do dwindle, e o splitratio só vale para o pai da
-- janela com foco (layoutMsg, DwindleAlgorithm.cpp:747, Hyprland 0.56.2). Então,
-- para cada janela: "splitratio 1" deixa ela com metade do pai, e "splitratio 0.5"
-- mostra a direção (mudou a largura ou a altura) e o lado (o filho 0 encolhe para
-- 1/4, o filho 1 cresce para 3/4). Daí sai a caixa do pai; as outras janelas com o
-- centro nela formam o irmão, e o peso do irmão (quantas colunas ou linhas ele tem)
-- sai da geometria. Tudo roda numa chamada Lua só, então nada é desenhado entre
-- os passos e só o resultado final anima.
--
-- Limite: uma divisão com grupos de janelas dos dois lados não tem janela filha
-- direta, o splitratio não chega nela, e ela fica como está. O atalho avisa.

local M = {}

-- Folga em pixels para bordas que encostam (gaps desligados com SUPER + SHIFT + BACKSPACE).
local EDGE_TOLERANCE = 2
-- Diferença aceita entre a divisão final e a esperada, antes de avisar.
local CHECK_TOLERANCE_PX = 8

local function rect_of(window)
  local at, size = window.at, window.size
  return { x0 = at.x, y0 = at.y, x1 = at.x + size.x, y1 = at.y + size.y }
end

local function center_inside(rect, box)
  local cx, cy = (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2
  return cx > box.x0 and cx < box.x1 and cy > box.y0 and cy < box.y1
end

-- Uma linha reta (vertical para dim "x", horizontal para "y") que separa os
-- retângulos em dois grupos sem cortar nenhum. Devolve os dois grupos, ou nil.
local function find_cut(rects, dim)
  local lo_key, hi_key = dim .. "0", dim .. "1"
  for _, candidate in ipairs(rects) do
    local line = candidate[hi_key]
    local low, high = {}, {}
    for _, r in ipairs(rects) do
      if r[hi_key] <= line + EDGE_TOLERANCE then
        low[#low + 1] = r
      elseif r[lo_key] >= line - EDGE_TOLERANCE then
        high[#high + 1] = r
      else
        low = nil
        break
      end
    end
    if low and #high > 0 then
      return low, high
    end
  end
end

-- Peso de um grupo ao longo de um eixo: quantas colunas (axis "x") ou linhas
-- (axis "y") ele tem. Divisão no mesmo eixo soma, divisão no outro eixo pega o maior.
local function weight(rects, axis)
  if #rects <= 1 then
    return #rects
  end
  for _, dim in ipairs({ "x", "y" }) do
    local low, high = find_cut(rects, dim)
    if low then
      local a, b = weight(low, axis), weight(high, axis)
      return dim == axis and a + b or math.max(a, b)
    end
  end
  return #rects
end

-- O "%f" do Lua segue o locale; o splitratio quer ponto decimal sempre.
local function ratio_arg(ratio)
  local scaled = math.floor(ratio * 10000 + 0.5)
  return string.format("splitratio %d.%04d exact", scaled // 10000, scaled % 10000)
end

-- Acerta o splitratio do pai de uma janela. A janela tem que estar com foco.
local function balance_parent(window, windows)
  hl.dispatch(hl.dsp.layout("splitratio 1 exact"))
  local half = rect_of(window)
  hl.dispatch(hl.dsp.layout("splitratio 0.5 exact"))
  local quarter = rect_of(window)

  local dw = (quarter.x1 - quarter.x0) - (half.x1 - half.x0)
  local dh = (quarter.y1 - quarter.y0) - (half.y1 - half.y0)
  if dw == 0 and dh == 0 then
    -- Nada mudou: janela sozinha no workspace ou fora da árvore.
    return
  end

  local horizontal = math.abs(dw) > math.abs(dh)
  local is_first = (horizontal and dw or dh) < 0

  local box = { x0 = half.x0, y0 = half.y0, x1 = half.x1, y1 = half.y1 }
  if horizontal then
    local w = half.x1 - half.x0
    if is_first then box.x1 = half.x1 + w else box.x0 = half.x0 - w end
  else
    local h = half.y1 - half.y0
    if is_first then box.y1 = half.y1 + h else box.y0 = half.y0 - h end
  end

  local sibling = {}
  for _, other in ipairs(windows) do
    if other.address ~= window.address then
      local r = rect_of(other)
      if center_inside(r, box) then
        sibling[#sibling + 1] = r
      end
    end
  end

  local theirs = math.max(1, weight(sibling, horizontal and "x" or "y"))
  local first_share = is_first and 1 / (1 + theirs) or theirs / (1 + theirs)
  hl.dispatch(hl.dsp.layout(ratio_arg(2 * first_share)))
end

-- Confere o resultado pela geometria: em cada divisão, a linha tem que estar
-- onde os pesos mandam. Devolve false se alguma ficou fora.
local function is_balanced(rects)
  if #rects <= 1 then
    return true
  end
  for _, dim in ipairs({ "x", "y" }) do
    local low, high = find_cut(rects, dim)
    if low then
      local lo_key, hi_key = dim .. "0", dim .. "1"
      local start, finish, low_end, high_start = math.huge, -math.huge, -math.huge, math.huge
      for _, r in ipairs(rects) do
        start, finish = math.min(start, r[lo_key]), math.max(finish, r[hi_key])
      end
      for _, r in ipairs(low) do low_end = math.max(low_end, r[hi_key]) end
      for _, r in ipairs(high) do high_start = math.min(high_start, r[lo_key]) end

      local a, b = weight(low, dim), weight(high, dim)
      local expected = start + (finish - start) * a / (a + b)
      local actual = (low_end + high_start) / 2
      if math.abs(actual - expected) > CHECK_TOLERANCE_PX then
        return false
      end
      return is_balanced(low) and is_balanced(high)
    end
  end
  return true
end

local function notify(message)
  hl.exec_cmd("notify-send -a 'Igualar janelas' 'Igualar janelas' '" .. message .. "'")
end

function M.equalize_workspace()
  local workspace = hl.get_active_workspace()
  if not workspace then
    return
  end
  if workspace.tiled_layout ~= "dwindle" then
    notify("Só funciona no layout tiling (dwindle). Este workspace está em " .. tostring(workspace.tiled_layout) .. ".")
    return
  end
  if workspace.has_fullscreen then
    notify("Saia da tela cheia antes de igualar.")
    return
  end

  local windows = {}
  for _, window in ipairs(hl.get_workspace_windows(workspace)) do
    if window.mapped and not window.hidden and not window.floating then
      windows[#windows + 1] = window
    end
  end
  if #windows < 2 then
    return
  end

  local active = hl.get_active_window()
  local cursor = hl.get_cursor_pos()

  -- Foca da menos recente para a mais recente, para o Alt+Tab manter a ordem.
  table.sort(windows, function(a, b)
    return (a.focus_history_id or 0) > (b.focus_history_id or 0)
  end)

  for _, window in ipairs(windows) do
    hl.dispatch(hl.dsp.focus({ window = window }))
    balance_parent(window, windows)
  end

  if active then
    hl.dispatch(hl.dsp.focus({ window = active }))
  end
  -- O foco leva o cursor para o meio da janela; ele volta para onde estava.
  hl.dispatch(hl.dsp.cursor.move({ x = math.floor(cursor.x), y = math.floor(cursor.y) }))

  local rects = {}
  for _, window in ipairs(windows) do
    rects[#rects + 1] = rect_of(window)
  end
  if not is_balanced(rects) then
    notify("Uma divisão entre dois grupos de janelas ficou como estava: o dwindle só ajusta divisões com uma janela de um dos lados.")
  end
end

return M
