-- Arranjo das telas externas (plugin cateim.arranjo-telas, spec 8.4).
--
-- Lê ~/.config/hypr/monitors-arranjo.tsv (gravado pelo painel, SUPER + ALT + P) e mescla modo,
-- posição e orientação nas regras que já existem no monitors.lua. Só mescla: uma tela sem
-- regra própria no monitors.lua nunca recebe chamada daqui, e por isso a escala continua sendo
-- a da regra escrita lá. O notebook (eDP-1) nunca é alvo.
--
-- Segurança: o arquivo é só dado. Nada dele vira código (sem load, sem dofile, sem
-- os.execute, sem io.popen); os valores vão para o hl.monitor como strings e números. Tudo ou
-- nada: uma linha inválida invalida o arquivo, e aí valem só as regras do monitors.lua.
--
-- O require só define funções. Quem chama aplicar() é o hyprland.lua, dentro de um pcall.
-- O mesmo formato é lido pelo painel (Dados.js, lerTsv e regrasDoMonitorsLua), testado com as
-- mesmas fixtures (tests/carregador.test.lua na pasta do plugin).

local M = {}

local CABECALHO = "# cateim.arranjo-telas v1"
local MAX_LINHAS_TSV = 32          -- linhas de tela no arquivo
local MAX_BYTES_TSV = 8192         -- arquivo inteiro, em bytes
local MAX_BYTES_LINHA = 512        -- uma linha física, sem o "\n"
local MAX_DESC = 128               -- desc, em pontos de código
local MAX_PORTA = 32               -- porta, em bytes
local MAX_POS = 32768              -- valor absoluto de x e de y
local MAX_BYTES_MONITORS = 65536   -- só esse começo do monitors.lua é lido
local MAX_LINHAS_MONITORS = 500    -- e só essas linhas dele
local CAMPOS_TSV = 7
local SEM_VALOR = "-"
local INICIO_FIM = "fim\t"
local SUBSTITUTO = "\239\191\189" -- U+FFFD em UTF-8; o painel recusa, aqui também
local BOM = "\239\187\191"        -- marca de ordem de bytes do UTF-8 no começo: pulada, como no painel
local PORTAS_INTERNAS = { "eDP-", "LVDS-", "DSI-" }
local ARQUIVO_TSV = "monitors-arranjo.tsv"
local ERRO_ARQUIVO_AUSENTE = 2     -- ENOENT

-- ---- texto ----

-- Quebra em "\n" sem padrão sobre o dado. Um "\n" no fim (ou texto vazio) não cria linha
-- vazia a mais, como o linhasFisicas do Dados.js. O laço anda pelo texto, que já tem tamanho
-- limitado por quem chama.
local function linhasFisicas(texto, maximo)
  local linhas, inicio = {}, 1
  while #linhas < maximo do
    local quebra = texto:find("\n", inicio, true)
    if not quebra then
      if inicio <= #texto then linhas[#linhas + 1] = texto:sub(inicio) end
      break
    end
    linhas[#linhas + 1] = texto:sub(inicio, quebra - 1)
    inicio = quebra + 1
  end
  return linhas
end

-- Os campos de uma linha de tela, separados por tab, com os vazios. Para no oitavo pedaço:
-- mais de sete já é recusa por colunas.
local function camposDaLinha(linha)
  local campos, inicio = {}, 1
  while #campos <= CAMPOS_TSV do
    local tab = linha:find("\t", inicio, true)
    if not tab then
      campos[#campos + 1] = linha:sub(inicio)
      break
    end
    campos[#campos + 1] = linha:sub(inicio, tab - 1)
    inicio = tab + 1
  end
  return campos
end

local function comeca(s, prefixo)
  return s:sub(1, #prefixo) == prefixo
end

-- Número da linha (a partir de 1) do byte na posição pos. O laço tem no máximo uma volta por
-- byte do texto, que já tem tamanho limitado por quem chama.
local function linhaDoByte(texto, pos)
  local linha, inicio = 1, 1
  for _ = 0, #texto do
    local quebra = texto:find("\n", inicio, true)
    if not quebra or quebra >= pos then return linha end
    linha = linha + 1
    inicio = quebra + 1
  end
  return linha
end

-- Posição do primeiro byte de UTF-8 inválido ou do primeiro U+FFFD, ou nil. O painel lê o
-- arquivo já decodificado e só vê um U+FFFD no lugar do byte ruim, então os dois recusam
-- os dois casos, no arquivo inteiro (mesmo arquivo, mesmo veredito).
local function primeiroCaractereRuim(texto)
  local n, invalido = utf8.len(texto)
  local substituto = texto:find(SUBSTITUTO, 1, true)
  if n then return substituto end
  if substituto and substituto < invalido then return substituto end
  return invalido
end

-- ---- validadores (as regras de campo da spec 8.3) ----

local function descValida(s)
  local n = utf8.len(s)   -- nil em UTF-8 inválido
  return n ~= nil and n >= 1 and n <= MAX_DESC
    and not s:find("[\0-\31\127]")
    and not s:find(SUBSTITUTO, 1, true)
end

local function portaValida(s)
  return #s >= 1 and #s <= MAX_PORTA and s:find("^[A-Za-z0-9%._%-]+$") ~= nil
end

local function portaInterna(s)
  for _, prefixo in ipairs(PORTAS_INTERNAS) do
    if comeca(s, prefixo) then return true end
  end
  return false
end

local function entre(s, minimo, maximo)
  return #s >= minimo and #s <= maximo
end

-- ^[0-9]{3,5}x[0-9]{3,5}@[0-9]{1,3}(\.[0-9]{1,3})?$
local function modoValido(s)
  local w, h, hz, fracao = s:match("^([0-9]+)x([0-9]+)@([0-9]+)%.([0-9]+)$")
  if not w then
    w, h, hz = s:match("^([0-9]+)x([0-9]+)@([0-9]+)$")
    fracao = "0"
  end
  return w ~= nil and entre(w, 3, 5) and entre(h, 3, 5) and entre(hz, 1, 3) and entre(fracao, 1, 3)
end

-- ^-?[0-9]{1,5}$ e |v| <= 32768
local function posicaoValida(s)
  if not s:find("^%-?[0-9][0-9]?[0-9]?[0-9]?[0-9]?$") then return false end
  return math.abs(tonumber(s)) <= MAX_POS
end

-- O primeiro campo que falha, ou nil. Mesma ordem do motivoDosCampos do Dados.js.
local function motivoDosCampos(c)
  if not descValida(c[1]) then return "desc" end
  if not portaValida(c[2]) then return "porta" end
  if portaInterna(c[2]) then return "portaInterna" end
  if not modoValido(c[3]) then return "modo" end
  if not posicaoValida(c[4]) or not posicaoValida(c[5]) then return "posicao" end
  if not c[6]:find("^[0-3]$") then return "transform" end
  if not c[7]:find("^[0-9][0-9][0-9][0-9]%-[0-9][0-9]%-[0-9][0-9]$") then return "visto" end
  return nil
end

-- ---- monitors.lua ----

-- Posição logo depois do "]" .. nivel .. "]" que fecha um comentário longo, procurando a
-- partir de inicio, ou nil quando a linha não o fecha.
local function fimDoBloco(linha, inicio, nivel)
  local fecho = "]" .. nivel .. "]"
  local i = linha:find(fecho, inicio, true)
  return i and i + #fecho or nil
end

-- O nível de um comentário longo que fica aberto no fim da linha, procurando a partir de
-- inicio, ou nil. Como no corte da regra, o primeiro "--" abre o comentário, mesmo dentro de
-- uma string; o painel faz igual.
local function blocoAbertoNoFim(linha, inicio)
  local pos = inicio
  for _ = 0, #linha do
    local traco = linha:find("--", pos, true)
    if not traco then return nil end
    local nivel = linha:match("^%-%-%[(=*)%[", traco)
    if not nivel then return nil end   -- comentário de linha: o resto não conta
    local fim = fimDoBloco(linha, traco + 4 + #nivel, nivel)
    if not fim then return nivel end
    pos = fim
  end
  return nil
end

-- Nomes com regra: linha que começa com hl.monitor({ output = "<nome>", e termina em }),
-- com espaços e um comentário -- opcionais depois (o formato que o
-- omarchy-hyprland-monitor-scaling lê e grava).
-- O catch-all (output = "") não conta. Regra montada por código não é reconhecida. Linha
-- dentro de comentário longo (--[[ ]] ou --[==[ ]==]) não é regra. Limite conhecido, igual
-- no painel: nada é avaliado, então regra dentro de "if false then" ou de string longa conta.
local function nomesComRegra(texto)
  local nomes = {}
  local linhas = linhasFisicas(texto:sub(1, MAX_BYTES_MONITORS), MAX_LINHAS_MONITORS)
  local nivel = nil
  for _, linha in ipairs(linhas) do
    local inicio = 1
    if nivel then
      -- a regra começa na coluna 1, então o resto da linha que fecha o bloco nunca é regra
      inicio = fimDoBloco(linha, 1, nivel)
    else
      local _, fimPrefixo, nome = linha:find('^hl%.monitor%(%{ output = "([^"]+)",')
      if nome then
        local resto = linha:sub(fimPrefixo + 1)
        local comentario = resto:find("--", 1, true)
        local codigo = comentario and resto:sub(1, comentario - 1) or resto
        if codigo:find("%}%)[ \t\n\v\f\r]*$") then nomes[nome] = true end
      end
    end
    if inicio then nivel = blocoAbertoNoFim(linha, inicio) end
  end
  return nomes
end

-- ---- monitors-arranjo.tsv ----

local function recusa(linha, motivo) return nil, linha, motivo end

-- Lista de telas do arquivo, ou nil, linha, motivo (linha 0 = o arquivo inteiro).
local function lerTsv(texto)
  if comeca(texto, BOM) then texto = texto:sub(#BOM + 1) end
  if #texto > MAX_BYTES_TSV then return recusa(0, "bytes") end
  local ruim = primeiroCaractereRuim(texto)
  if ruim then return recusa(linhaDoByte(texto, ruim), "utf8") end
  local linhas = linhasFisicas(texto, MAX_BYTES_TSV + 1)
  for i, linha in ipairs(linhas) do
    if #linha > MAX_BYTES_LINHA then return recusa(i, "linhaLonga") end
  end
  if #linhas == 0 or linhas[1] ~= CABECALHO then return recusa(1, "cabecalho") end
  local telas, portas, descs = {}, {}, {}
  local linhaFim, contagem = 0, ""
  for numero = 2, #linhas do
    local linha = linhas[numero]
    if linhaFim > 0 then
      if linha ~= "" then return recusa(numero, "fim") end
    elseif linha == "" or comeca(linha, "#") then
      -- linha vazia ou comentário: pula
    elseif comeca(linha, INICIO_FIM) then
      linhaFim = numero
      contagem = linha:sub(#INICIO_FIM + 1)
    else
      local c = camposDaLinha(linha)
      if #c ~= CAMPOS_TSV then return recusa(numero, "colunas") end
      local motivo = motivoDosCampos(c)
      if motivo then return recusa(numero, motivo) end
      if c[2] ~= SEM_VALOR and portas[c[2]] then return recusa(numero, "portaRepetida") end
      if c[1] ~= SEM_VALOR and descs[c[1]] then return recusa(numero, "descRepetida") end
      portas[c[2]] = true
      descs[c[1]] = true
      telas[#telas + 1] = {
        desc = c[1], porta = c[2], modo = c[3],
        x = math.tointeger(tonumber(c[4])), y = math.tointeger(tonumber(c[5])),
        transform = math.tointeger(tonumber(c[6])),
      }
      if #telas > MAX_LINHAS_TSV then return recusa(numero, "linhas") end
    end
  end
  if linhaFim == 0 then return recusa(math.max(#linhas, 1), "fim") end
  if not contagem:find("^[0-9]+$") or tonumber(contagem) ~= #telas then
    return recusa(linhaFim, "contagem")
  end
  return telas
end

local function chamada(output, tela)
  return {
    output = output,
    mode = tela.modo,
    position = string.format("%dx%d", tela.x, tela.y),
    transform = tela.transform,
  }
end

-- Função pura: as chamadas de hl.monitor que o arranjo pede, ou nil, linha, motivo.
-- Primeiro as desc: (na ordem do arquivo), depois as portas (na ordem do arquivo): a regra da
-- porta fica por último e vence enquanto a tela está nela. Só sai o que tem regra.
function M.planejar(texto_tsv, texto_monitors)
  local telas, linha, motivo = lerTsv(texto_tsv or "")
  if not telas then return nil, linha, motivo end
  local regras = nomesComRegra(texto_monitors or "")
  local chamadas = {}
  for _, tela in ipairs(telas) do
    local output = "desc:" .. tela.desc
    if tela.desc ~= SEM_VALOR and regras[output] then chamadas[#chamadas + 1] = chamada(output, tela) end
  end
  for _, tela in ipairs(telas) do
    if tela.porta ~= SEM_VALOR and regras[tela.porta] then chamadas[#chamadas + 1] = chamada(tela.porta, tela) end
  end
  return chamadas
end

-- Lê no máximo `limite` bytes. nil, erro, código quando não abre.
local function lerLimitado(caminho, limite)
  local f, erro, codigo = io.open(caminho, "rb")
  if not f then return nil, erro, codigo end
  local texto = f:read(limite) or ""
  f:close()
  return texto
end

-- `caminhos` = { monitors = ..., tsv = ... } só nos testes. Sem ele, o monitors.lua é o mesmo
-- arquivo que o require("hypr.monitors") carregou, e o TSV fica na mesma pasta.
function M.aplicar(caminhos)
  caminhos = caminhos or {}
  local monitors = caminhos.monitors or package.searchpath("hypr.monitors", package.path)
  if not monitors then
    print("monitors-arranjo: monitors.lua not found")
    return
  end
  local tsv = caminhos.tsv or ((monitors:match("^(.*)/[^/]*$") or ".") .. "/" .. ARQUIVO_TSV)

  local texto_tsv, erro, codigo = lerLimitado(tsv, #BOM + MAX_BYTES_TSV + 1)
  if not texto_tsv then
    -- Sem arquivo é o caso normal antes do primeiro Manter: valem as regras do monitors.lua.
    if codigo ~= ERRO_ARQUIVO_AUSENTE then print("monitors-arranjo: " .. tostring(erro)) end
    return
  end
  local texto_monitors, erro_monitors = lerLimitado(monitors, MAX_BYTES_MONITORS)
  if not texto_monitors then
    print("monitors-arranjo: " .. tostring(erro_monitors))
    return
  end

  local chamadas, linha, motivo = M.planejar(texto_tsv, texto_monitors)
  if not chamadas then
    print("monitors-arranjo: linha " .. linha .. ": " .. motivo)
    return
  end
  for _, c in ipairs(chamadas) do hl.monitor(c) end
end

return M
