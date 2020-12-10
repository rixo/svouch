import { writable, derived } from 'svelte/store'

import { yup } from '../util.js'

// - don't trigger a change event if set value is the same
// - expose current (last) value publicly
// export const lazy = (initial, ...args) => {
export const makeLazy = (equals) => (initial, ...args) => {
  const store = writable(initial, ...args)

  store.value = initial

  const set = store.set

  store.set = (value, force = false) => {
    if (force || !equals(value, store.value)) {
      store.value = value
      set(value)
    }
  }

  store.update = (fn, force = false) => {
    store.set(fn(store.value), force)
  }

  store.ping = () => {
    set(store.value)
  }

  return store
}

export const lazy = makeLazy((a, b) => a === b)

const isPrimitive = (x) => x !== Object(x)

const dumbDeepEquals = (a, b) => {
  if (a === b) return true
  if (isPrimitive(a)) return a === b
  // if they're falsy but not strictly equal, then they're not equal
  if (!a || !b) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    // if (a[k] !== b[k]) return false
    if (!dumbDeepEquals(a[k], b[k])) return false
  }
  return true
}

export const deeplyLazy = makeLazy(dumbDeepEquals)

export const dedupe = (store) =>
  derived(store, ($x, set) => {
    let initial = true
    let last
    if (initial || $x !== last) {
      initial = false
      last = $x
      set($x)
    }
  })

export const debounced = (store, debounce, initial, predicate = yup) =>
  derived(
    store,
    ($x, _set) => {
      const notify = () => _set($x)

      let timeout

      if (debounce !== false && predicate($x)) {
        timeout = setTimeout(notify, debounce)
      } else {
        notify()
      }

      return () => {
        clearTimeout(timeout)
      }
    },
    initial
  )

export const listening = (store, event, initial, getValue) =>
  derived(
    store,
    ($x, set) => {
      store.value = false
      set(initial)

      const listener = (...args) => {
        store.value = getValue(...args)
        set(store.value)
      }

      $x.on(event, listener)

      return () => {
        $x.removeListener(event, listener)
      }
    },
    initial
  )
