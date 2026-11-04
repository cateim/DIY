.pragma library

// Pure helpers for the window switcher: no QML, no Hyprland, so they can be
// tested with `node --test tests/` (see tests/WindowSwitcherModel.test.mjs).

var ACTIONS = { next: true, prev: true, confirm: true, cancel: true }

// Hyprland reports the same window as "0x55d0..." (hyprctl clients) and as
// "55d0..." (socket2 events). One spelling everywhere: lowercase, no prefix.
function normalizeAddress(address) {
  var value = String(address || "").trim().toLowerCase()
  return value.indexOf("0x") === 0 ? value.slice(2) : value
}

// A bind runs hl.dsp.event("cateim-switcher>>next"); socket2 delivers it as
// event "custom" with data "cateim-switcher>>next". Returns "" for anything else.
function switcherAction(eventData, prefix) {
  var data = String(eventData || "")
  var head = prefix + ">>"
  if (data.indexOf(head) !== 0) return ""
  var action = data.slice(head.length).trim()
  return ACTIONS[action] === true ? action : ""
}

// activewindowv2 data is the bare address; closewindow data is too.
function moveToFront(mru, address) {
  var key = normalizeAddress(address)
  if (!key) return mru.slice()
  var out = [key]
  for (var i = 0; i < mru.length; i++) if (mru[i] !== key) out.push(mru[i])
  return out
}

function removeAddress(mru, address) {
  var key = normalizeAddress(address)
  return mru.filter(function(value) { return value !== key })
}

// Startup seed from `hyprctl clients -j`: focusHistoryID 0 is the window focused last.
function seedFromClients(clients) {
  if (!Array.isArray(clients)) return []
  return clients
    .filter(function(client) { return client && client.address })
    .slice()
    .sort(function(a, b) { return (a.focusHistoryID || 0) - (b.focusHistoryID || 0) })
    .map(function(client) { return normalizeAddress(client.address) })
}

// The startup seed can land after the first focus events; those events are
// newer, so they stay in front and the seed only fills in what they missed.
function mergeRecency(live, seeded) {
  var out = live.slice()
  for (var i = 0; i < seeded.length; i++) if (out.indexOf(seeded[i]) < 0) out.push(seeded[i])
  return out
}

// Hyprland addresses are hex; anything else never reaches a dispatch string.
function isSafeAddress(address) {
  return /^[0-9a-f]+$/.test(String(address || ""))
}

// Orders entries ({ address }) by recency. Windows never seen focused keep
// their original relative order, after every window that was.
function orderByRecency(entries, mru) {
  var rank = {}
  for (var i = 0; i < mru.length; i++) rank[mru[i]] = i
  return entries
    .map(function(entry, index) { return { entry: entry, index: index } })
    .sort(function(a, b) {
      var ra = rank.hasOwnProperty(a.entry.address) ? rank[a.entry.address] : mru.length + a.index
      var rb = rank.hasOwnProperty(b.entry.address) ? rank[b.entry.address] : mru.length + b.index
      return ra - rb
    })
    .map(function(item) { return item.entry })
}

// Alt+Tab starts on the previous window, Alt+Shift+Tab on the oldest one.
function initialIndex(count, step) {
  if (count <= 1) return 0
  return step < 0 ? count - 1 : 1
}

function stepIndex(index, count, step) {
  if (count <= 0) return 0
  return ((index + step) % count + count) % count
}

// Largest size with the source aspect ratio that fits inside the box.
function fitSize(sourceWidth, sourceHeight, boxWidth, boxHeight) {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return { width: boxWidth, height: boxHeight }
  var scale = Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight)
  return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale) }
}
