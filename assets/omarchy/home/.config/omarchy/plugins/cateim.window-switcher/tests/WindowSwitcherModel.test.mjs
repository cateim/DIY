// Run from the plugin directory: node --test tests/
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

// The model is a QML `.pragma library` script; drop the pragma and load it
// into a sandbox so node sees the same functions QML does.
const source = readFileSync(new URL("../WindowSwitcherModel.js", import.meta.url), "utf8")
const model = {}
vm.runInNewContext(source.replace(/^\.pragma library\s*$/m, ""), model)
// Values built inside the sandbox carry its own prototypes, which deepStrictEqual
// rejects; compare plain JSON copies instead.
const plain = (value) => JSON.parse(JSON.stringify(value))

test("normalizeAddress strips 0x and lowercases", () => {
  assert.equal(model.normalizeAddress("0x55D0ab"), "55d0ab")
  assert.equal(model.normalizeAddress("55d0ab"), "55d0ab")
  assert.equal(model.normalizeAddress(null), "")
})

test("switcherAction accepts only known actions under the prefix", () => {
  assert.equal(model.switcherAction("cateim-switcher>>next", "cateim-switcher"), "next")
  assert.equal(model.switcherAction("cateim-switcher>>confirm", "cateim-switcher"), "confirm")
  assert.equal(model.switcherAction("cateim-switcher>>rm -rf", "cateim-switcher"), "")
  assert.equal(model.switcherAction("other>>next", "cateim-switcher"), "")
})

test("moveToFront puts the address first without duplicates", () => {
  assert.deepEqual(plain(model.moveToFront(["a", "b", "c"], "0xC")), ["c", "a", "b"])
  assert.deepEqual(plain(model.moveToFront(["a", "b"], "d")), ["d", "a", "b"])
  assert.deepEqual(plain(model.moveToFront(["a"], "")), ["a"])
})

test("removeAddress drops a closed window", () => {
  assert.deepEqual(plain(model.removeAddress(["a", "b", "c"], "0xb")), ["a", "c"])
})

test("seedFromClients orders by focusHistoryID", () => {
  const clients = [
    { address: "0xB", focusHistoryID: 2 },
    { address: "0xA", focusHistoryID: 0 },
    { address: "0xC", focusHistoryID: 1 },
  ]
  assert.deepEqual(plain(model.seedFromClients(clients)), ["a", "c", "b"])
  assert.deepEqual(plain(model.seedFromClients("garbage")), [])
})

test("mergeRecency keeps live focus events in front of the seed", () => {
  assert.deepEqual(plain(model.mergeRecency(["c"], ["a", "c", "b"])), ["c", "a", "b"])
  assert.deepEqual(plain(model.mergeRecency([], ["a", "b"])), ["a", "b"])
})

test("isSafeAddress only accepts hex", () => {
  assert.equal(model.isSafeAddress("55d0ab"), true)
  assert.equal(model.isSafeAddress('55" }) os.execute("x'), false)
  assert.equal(model.isSafeAddress(""), false)
})

test("orderByRecency puts unknown windows last, keeping their order", () => {
  const entries = [{ address: "x" }, { address: "b" }, { address: "y" }, { address: "a" }]
  const ordered = model.orderByRecency(entries, ["a", "b"]).map((e) => e.address)
  assert.deepEqual(plain(ordered), ["a", "b", "x", "y"])
})

test("initialIndex starts on the previous window, or the oldest with Shift", () => {
  assert.equal(model.initialIndex(0, 1), 0)
  assert.equal(model.initialIndex(1, 1), 0)
  assert.equal(model.initialIndex(4, 1), 1)
  assert.equal(model.initialIndex(4, -1), 3)
})

test("stepIndex wraps both ways", () => {
  assert.equal(model.stepIndex(3, 4, 1), 0)
  assert.equal(model.stepIndex(0, 4, -1), 3)
  assert.equal(model.stepIndex(0, 0, 1), 0)
})

test("fitSize keeps aspect ratio inside the box", () => {
  assert.deepEqual(plain(model.fitSize(2560, 1080, 320, 200)), { width: 320, height: 135 })
  assert.deepEqual(plain(model.fitSize(1080, 1920, 320, 200)), { width: 113, height: 200 })
  assert.deepEqual(plain(model.fitSize(0, 0, 320, 200)), { width: 320, height: 200 })
})
