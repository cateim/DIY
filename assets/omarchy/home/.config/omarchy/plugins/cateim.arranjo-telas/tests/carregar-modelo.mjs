// Loads the plugin's QML `.pragma library` scripts into node, the way the
// window-switcher tests do, and resolves `.import "X.js" as Q` between them.
import { readFileSync } from "node:fs"
import vm from "node:vm"

const cache = new Map()

// Reads ../<arquivo>, drops the pragma, binds each `.import` to the loaded
// module and runs the rest in a fresh context. The context is cached before it
// runs, so an import cycle returns the half-built module instead of recursing.
export function carregar(arquivo) {
  if (cache.has(arquivo)) return cache.get(arquivo)
  const contexto = {}
  cache.set(arquivo, contexto)
  let fonte = readFileSync(new URL("../" + arquivo, import.meta.url), "utf8")
  fonte = fonte.replace(/^\.pragma library\s*$/m, "")
  fonte = fonte.replace(/^\.import\s+"([^"]+)"\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm, (_, alvo, nome) => {
    contexto[nome] = carregar(alvo)
    return ""
  })
  vm.runInNewContext(fonte, contexto)
  return contexto
}

// Values built inside the sandbox carry its own prototypes, which
// deepStrictEqual rejects; compare plain JSON copies instead.
export function plain(valor) {
  return JSON.parse(JSON.stringify(valor))
}

export function fixture(caminho) {
  return readFileSync(new URL("./fixtures/" + caminho, import.meta.url), "utf8")
}
