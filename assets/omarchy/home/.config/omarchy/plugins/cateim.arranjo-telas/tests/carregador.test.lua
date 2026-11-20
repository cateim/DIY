-- Tests for the Hyprland loader ~/.config/hypr/monitors-arranjo.lua (spec 11.2).
-- Run from the plugin folder: lua5.5 tests/carregador.test.lua
-- ARRANJO_CARREGADOR points at another copy of the loader (mutation runs).
-- The TSV fixtures and esperado.txt are the same files the JS tests read.

local PASTA_TESTES = (arg and arg[0] or ""):match("^(.*)/[^/]*$") or "."
local FIXTURES = PASTA_TESTES .. "/fixtures"
local CAMINHO_CARREGADOR = os.getenv("ARRANJO_CARREGADOR")
  or (os.getenv("HOME") .. "/.config/hypr/monitors-arranjo.lua")

local RTK = "Invalid Vendor Codename - RTK FHD demoset-1"
local LG = "LG Electronics LG ULTRAWIDE 0x0003B53D"
local CAB = "# cateim.arranjo-telas v1\n# gerado pelo painel de arranjo das telas; não edite à mão\n"
local LINHAS_ESPERADO = 27
local CHAVES_PERMITIDAS = { output = true, mode = true, position = true, transform = true }

-- Fake Hyprland API: every hl.monitor call is recorded.
local chamadas = {}
hl = { monitor = function(t) chamadas[#chamadas + 1] = t end }

local function ler(caminho)
  local f = assert(io.open(caminho, "rb"))
  local texto = f:read("a")
  f:close()
  return texto
end

local function fixture(nome) return ler(FIXTURES .. "/" .. nome) end

local fonte, erro_carga = loadfile(CAMINHO_CARREGADOR)
if not fonte then
  print(erro_carga)
  os.exit(1)
end
local M = fonte()

-- ---- tiny runner ----

local total, falhas = 0, 0
local function teste(nome, f)
  total = total + 1
  chamadas = {}
  local ok, erro = pcall(f)
  if ok then
    print("ok   " .. nome)
  else
    falhas = falhas + 1
    print("FAIL " .. nome .. ": " .. tostring(erro))
  end
end

local function igual(a, b, contexto)
  if a ~= b then
    error((contexto or "") .. " esperado " .. tostring(b) .. ", veio " .. tostring(a), 2)
  end
end

local function conferirChamada(c, output, mode, position, transform)
  igual(c.output, output, "output")
  igual(c.mode, mode, "mode de " .. output)
  igual(c.position, position, "position de " .. output)
  igual(c.transform, transform, "transform de " .. output)
end

-- Runs aplicar with print captured; returns the printed lines.
local function aplicarCapturando(caminhos)
  local impressos = {}
  local printOriginal = print
  print = function(...)
    local partes = {}
    for i = 1, select("#", ...) do partes[#partes + 1] = tostring((select(i, ...))) end
    impressos[#impressos + 1] = table.concat(partes, "\t")
  end
  local ok, erro = pcall(M.aplicar, caminhos)
  print = printOriginal
  if not ok then error(erro, 2) end
  return impressos
end

-- Physical lines of a text, split on "\n" with plain find (no patterns on data).
local function linhasDe(texto)
  local linhas, inicio = {}, 1
  while true do
    local i = texto:find("\n", inicio, true)
    if not i then
      if inicio <= #texto then linhas[#linhas + 1] = texto:sub(inicio) end
      return linhas
    end
    linhas[#linhas + 1] = texto:sub(inicio, i - 1)
    inicio = i + 1
  end
end

local MONITORS = FIXTURES .. "/monitors.lua"
local TEXTO_MONITORS = fixture("monitors.lua")

-- ---- tests ----

teste("valido-2telas: 4 chamadas, desc: antes das portas", function()
  local impressos = aplicarCapturando({ monitors = MONITORS, tsv = FIXTURES .. "/tsv/valido-2telas.tsv" })
  igual(#impressos, 0, "prints")
  igual(#chamadas, 4, "chamadas")
  conferirChamada(chamadas[1], "desc:" .. RTK, "1920x1080@60.00", "2048x36", 0)
  conferirChamada(chamadas[2], "desc:" .. LG, "2560x1080@75", "-256x-1080", 0)
  conferirChamada(chamadas[3], "DP-1", "1920x1080@60.00", "2048x36", 0)
  conferirChamada(chamadas[4], "HDMI-A-4", "2560x1080@75", "-256x-1080", 0)
end)

teste("planejar devolve as mesmas 4 chamadas sem chamar hl", function()
  local plano = M.planejar(fixture("tsv/valido-2telas.tsv"), TEXTO_MONITORS)
  igual(#chamadas, 0, "chamadas no hl")
  igual(#plano, 4, "plano")
  conferirChamada(plano[1], "desc:" .. RTK, "1920x1080@60.00", "2048x36", 0)
  conferirChamada(plano[4], "HDMI-A-4", "2560x1080@75", "-256x-1080", 0)
end)

teste("TSV ausente: zero chamadas, sem erro e sem print", function()
  local impressos = aplicarCapturando({ monitors = MONITORS, tsv = "/caminho/que/nao/existe" })
  igual(#chamadas, 0, "chamadas")
  igual(#impressos, 0, "prints")
end)

teste("esperado.txt: mesma linha e mesmo motivo do JS", function()
  local linhas = linhasDe(fixture("tsv/esperado.txt"))
  igual(#linhas, LINHAS_ESPERADO, "linhas do esperado.txt")
  for _, l in ipairs(linhas) do
    local tab = l:find("\t", 1, true)
    local arquivo, esperado = l:sub(1, tab - 1), l:sub(tab + 1)
    local plano, linha, motivo = M.planejar(fixture("tsv/" .. arquivo), TEXTO_MONITORS)
    local resultado
    if plano then
      igual(type(plano), "table", arquivo)
      resultado = "valido"
    else
      resultado = tostring(linha) .. ":" .. tostring(motivo)
    end
    igual(resultado, esperado, arquivo)
  end
end)

teste("TSV inválido: print com linha e motivo, zero chamadas", function()
  local casos = {
    { "invalido-modo.tsv", "monitors-arranjo: linha 3: modo" },
    { "invalido-8k.tsv", "monitors-arranjo: linha 0: bytes" },
    { "invalido-porta-interna.tsv", "monitors-arranjo: linha 3: portaInterna" },
    { "invalido-porta-repetida.tsv", "monitors-arranjo: linha 4: portaRepetida" },
    { "invalido-utf8.tsv", "monitors-arranjo: linha 3: utf8" },
    { "invalido-desc-fffd.tsv", "monitors-arranjo: linha 3: utf8" },
    { "invalido-utf8-comentario.tsv", "monitors-arranjo: linha 2: utf8" },
  }
  for _, caso in ipairs(casos) do
    chamadas = {}
    local impressos = aplicarCapturando({ monitors = MONITORS, tsv = FIXTURES .. "/tsv/" .. caso[1] })
    igual(#chamadas, 0, caso[1] .. " chamadas")
    igual(#impressos, 1, caso[1] .. " prints")
    igual(impressos[1], caso[2], caso[1])
  end
end)

teste("BOM no começo não conta nos 8 KiB lidos pelo aplicar", function()
  local corpo = "Tela inventada\tDP-2\t1920x1080@60.00\t4000\t0\t0\t2026-11-20\nfim\t1\n"
  local texto = CAB
  while #texto + 400 + #corpo <= 8192 do texto = texto .. "#" .. string.rep("x", 398) .. "\n" end
  texto = texto .. "#" .. string.rep("x", 8192 - #texto - #corpo - 2) .. "\n" .. corpo
  igual(#texto, 8192, "tamanho sem o BOM")
  local caminho = os.tmpname()
  local f = assert(io.open(caminho, "wb"))
  f:write("\239\187\191" .. texto)
  f:close()
  local impressos = aplicarCapturando({ monitors = FIXTURES .. "/monitors.lua", tsv = caminho })
  os.remove(caminho)
  igual(#impressos, 0, "prints")
end)

teste("TSV vazio: linha 1, cabecalho", function()
  local vazio = os.tmpname()
  local impressos = aplicarCapturando({ monitors = MONITORS, tsv = vazio })
  os.remove(vazio)
  igual(#chamadas, 0, "chamadas")
  igual(impressos[1], "monitors-arranjo: linha 1: cabecalho", "print")
end)

teste("desc com cara de injeção vira só valor, nada é executado", function()
  local executeOriginal, popenOriginal = os.execute, io.popen
  local executou = false
  os.execute = function() executou = true; error("os.execute chamado") end
  io.popen = function() executou = true; error("io.popen chamado") end
  local ok, erro = pcall(function()
    -- valido-injecao.tsv: the desc has a double quote, so no desc: rule can
    -- carry its name; only the port goes out.
    aplicarCapturando({ monitors = MONITORS, tsv = FIXTURES .. "/tsv/valido-injecao.tsv" })
    igual(#chamadas, 1, "chamadas da fixture")
    conferirChamada(chamadas[1], "DP-1", "1920x1080@60.00", "2048x36", 0)
    -- A hostile desc without double quotes that does have a desc: rule.
    local hostil = "}) os.execute(x) -- ]] [[ end"
    local monitors = 'hl.monitor({ output = "desc:' .. hostil .. '", mode = "1920x1080@60", position = "0x0" })\n'
    local tsv = CAB .. hostil .. "\t-\t1920x1080@60.00\t2048\t36\t0\t2026-11-20\nfim\t1\n"
    local plano = assert(M.planejar(tsv, monitors))
    igual(#plano, 1, "chamadas da desc hostil")
    igual(plano[1].output, "desc:" .. hostil, "output literal")
  end)
  os.execute, io.popen = executeOriginal, popenOriginal
  if not ok then error(erro) end
  igual(executou, false, "executou algo")
end)

teste("nenhuma chamada tem chave além de output, mode, position e transform", function()
  local validos = { "valido-2telas.tsv", "valido-linhas-vazias.tsv", "valido-injecao.tsv", "valido-desc-128.tsv" }
  local vistas = 0
  for _, nome in ipairs(validos) do
    chamadas = {}
    aplicarCapturando({ monitors = MONITORS, tsv = FIXTURES .. "/tsv/" .. nome })
    for _, c in ipairs(chamadas) do
      vistas = vistas + 1
      for chave in pairs(c) do
        if not CHAVES_PERMITIDAS[chave] then error(nome .. ": chave " .. tostring(chave)) end
      end
      for chave in pairs(CHAVES_PERMITIDAS) do
        if c[chave] == nil then error(nome .. ": falta " .. chave) end
      end
    end
  end
  if vistas == 0 then error("nenhuma chamada conferida") end
end)

teste("regra desc: do LG fora do monitors.lua: só ela some", function()
  local partes = {}
  for _, l in ipairs(linhasDe(TEXTO_MONITORS)) do
    if not l:find('output = "desc:' .. LG .. '"', 1, true) then partes[#partes + 1] = l end
  end
  local semLg = table.concat(partes, "\n") .. "\n"
  local plano = assert(M.planejar(fixture("tsv/valido-2telas.tsv"), semLg))
  igual(#plano, 3, "chamadas")
  igual(plano[1].output, "desc:" .. RTK)
  igual(plano[2].output, "DP-1")
  igual(plano[3].output, "HDMI-A-4")
end)

teste("loadfile sem aplicar: zero chamadas", function()
  local carregado = assert(loadfile(CAMINHO_CARREGADOR))()
  igual(type(carregado.aplicar), "function", "aplicar")
  igual(type(carregado.planejar), "function", "planejar")
  igual(#chamadas, 0, "chamadas")
end)

teste("posição -0 e zeros à esquerda saem como números, igual ao JS", function()
  local tsv = CAB .. RTK .. "\tDP-1\t1920x1080@60.00\t-0\t007\t1\t2026-11-20\nfim\t1\n"
  local plano = assert(M.planejar(tsv, TEXTO_MONITORS))
  igual(#plano, 2, "chamadas")
  conferirChamada(plano[2], "DP-1", "1920x1080@60.00", "0x7", 1)
end)

-- monitors.lua limits: 500 lines and 64 KiB, both sides of each limit.
local REGRA_DP2 = 'hl.monitor({ output = "DP-2", mode = "1920x1080@60", position = "4000x0" })'
local TSV_DP2 = CAB .. "Tela inventada\tDP-2\t1920x1080@60.00\t4000\t0\t0\t2026-11-20\nfim\t1\n"

local function chamadasDp2(monitors)
  local plano = assert(M.planejar(TSV_DP2, monitors))
  return #plano
end

teste("monitors.lua: regra na linha 500 conta, na 501 não", function()
  igual(chamadasDp2(string.rep("-- x\n", 499) .. REGRA_DP2 .. "\n"), 1, "linha 500")
  igual(chamadasDp2(string.rep("-- x\n", 500) .. REGRA_DP2 .. "\n"), 0, "linha 501")
end)

teste("monitors.lua: regra até o byte 65536 conta, um byte depois não", function()
  local function comComentario(bytes) return "--" .. string.rep("x", bytes - 3) .. "\n" end
  local cabe = comComentario(65536 - #REGRA_DP2) .. REGRA_DP2
  igual(#cabe, 65536, "tamanho do texto")
  igual(chamadasDp2(cabe .. "\n"), 1, "termina no byte 65536")
  igual(chamadasDp2(comComentario(65536 - #REGRA_DP2 + 1) .. REGRA_DP2 .. "\n"), 0, "um byte depois")
  igual(chamadasDp2(comComentario(70000) .. REGRA_DP2 .. "\n"), 0, "70000 bytes antes")
end)

teste("monitors.lua: comentário depois de }) conta, }) só no comentário não", function()
  igual(chamadasDp2(REGRA_DP2 .. "  -- comentário }) \n"), 1, "comentário no fim")
  igual(chamadasDp2('hl.monitor({ output = "DP-2", mode = "1920x1080@60" -- })\n'), 0, "}) no comentário")
  igual(chamadasDp2(' ' .. REGRA_DP2 .. "\n"), 0, "fora da coluna 1")
  igual(chamadasDp2('hl.monitor({ output = "", mode = "preferred" })\n'), 0, "catch-all")
end)

teste("regrasDoMonitorsLua ignora regra em comentário de bloco", function()
  local regraDp3 = 'hl.monitor({ output = "DP-3", mode = "preferred" })'
  igual(chamadasDp2(REGRA_DP2 .. "\n"), 1, "sem comentário")
  igual(chamadasDp2("--[[\n" .. REGRA_DP2 .. "\n]]\n"), 0, "--[[ ]]")
  igual(chamadasDp2("--[==[\n]]\n" .. REGRA_DP2 .. "\n]==]\n"), 0, "--[==[ só fecha com ]==]")
  igual(chamadasDp2("--[==[\nx\n]==]\n" .. REGRA_DP2 .. "\n"), 1, "depois do ]==] conta")
  igual(chamadasDp2("--[[ x ]]\n" .. REGRA_DP2 .. "\n"), 1, "bloco aberto e fechado na mesma linha")
  igual(chamadasDp2("-- [[\n" .. REGRA_DP2 .. "\n"), 1, "-- [[ é comentário de linha")
  igual(chamadasDp2("---[[\n" .. REGRA_DP2 .. "\n"), 1, "---[[ é comentário de linha")
  igual(chamadasDp2("local x = 1 --[[ abre\n" .. REGRA_DP2 .. "\n]]\n"), 0, "aberto no fim de uma linha de código")
  igual(chamadasDp2("--[[ a ]] --[[ b\n" .. REGRA_DP2 .. "\n]]\n"), 0, "segundo bloco na mesma linha fica aberto")
  -- a rule line that opens a block keeps its own rule, and the block hides the next ones
  igual(chamadasDp2(REGRA_DP2 .. " --[[ comentário\n" .. regraDp3 .. "\n]]\n"), 1, "regra que abre o bloco")
end)

teste("modo: dígitos de cada parte, como a regex do 8.3", function()
  local function motivoDoModo(modo)
    local tsv = CAB .. "Tela inventada\tDP-2\t" .. modo .. "\t4000\t0\t0\t2026-11-20\nfim\t1\n"
    local plano, linha, motivo = M.planejar(tsv, REGRA_DP2 .. "\n")
    return plano and "valido" or (linha .. ":" .. motivo)
  end
  igual(motivoDoModo("800x600@50"), "valido", "800x600@50")
  igual(motivoDoModo("15360x8640@240.123"), "valido", "cinco dígitos e fração de três")
  igual(motivoDoModo("1920x1080@60.0001"), "3:modo", "fração de quatro")
  igual(motivoDoModo("1920x1080@60."), "3:modo", "ponto sem fração")
  igual(motivoDoModo("1920x1080@1000"), "3:modo", "taxa de quatro dígitos")
  igual(motivoDoModo("99x1080@60"), "3:modo", "largura de dois dígitos")
  igual(motivoDoModo("123456x1080@60"), "3:modo", "largura de seis dígitos")
  igual(motivoDoModo("1920X1080@60"), "3:modo", "X maiúsculo")
end)

print(string.format("%d de %d OK", total - falhas, total))
os.exit(falhas == 0 and 0 or 1)
