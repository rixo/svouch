import { writable } from 'svelte/store'

// - don't trigger a change event if set value is the same
// - expose current (last) value publicly
// export const lazy = (initial, ...args) => {
export const makeLazy = (equals) => (initial, ...args) => {
  const store = writable(initial, ...args)

  store.value = initial

  const set = store.set

  store.set = (value) => {
    if (!equals(value, store.value)) {
      store.value = value
      set(value)
    }
  }

  store.update = (fn) => {
    store.set(fn(store.value))
  }

  return store
}

export const lazy = makeLazy((a, b) => a === b)

const dumbDeepEquals = (a, b) => {
  if (a === b) return true
  // if they're falsy but not strictly equal, then they're not equal
  if (!a || !b) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (a[k] !== b[k]) return false
  }
  return true
}

export const deeplyLazy = makeLazy(dumbDeepEquals)

export const transform = (store, transform) => {
  const { set } = store

  store.set = (value) => set(transform(value))

  return store
}
