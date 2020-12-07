import { writable, derived } from 'svelte/store'
import { createSvouchStore } from './store.js'

const callMethod = (fn) => (x) => x[fn]()

const getProp = (prop) => (x) => x[prop]

const some = (fn) => (x) => x.some(fn)

const getRecordDoc = (record) => record.$$.doc

export const createCollection = (
  { connect },
  { name, schemaAdapter, schema, autoCommit, makeId }
) => {
  const prefix = name + '/'

  // --- Child stores ---

  const _stores = new Set()

  const stores = writable([..._stores])

  function addStore(store) {
    const n = _stores.size
    _stores.add(store)
    // guard: store was already registered
    if (_stores.size === n) return
    stores.set([..._stores])

    return () => {
      const n = _stores.size
      _stores.delete(store)
      // guard: store was already not registered
      if (_stores.size === n) return
      stores.set([..._stores])
    }
  }

  // --- Dirty, busy ---

  const dirty$ = derived(stores, ($stores) =>
    derived($stores.map(getProp('dirty')), some(Boolean))
  )

  const busy$ = derived(stores, ($stores) =>
    derived($stores.map(getProp('busy')), some(Boolean))
  )

  const dirty = derived(dirty$, (dirties, set) => dirties.subscribe(set))

  const busy = derived(busy$, (busies, set) => busies.subscribe(set))

  // --- Commit ---

  const commit = () => Promise.all(_stores.map(callMethod('commit')))

  const commitManaged = () =>
    Promise.all(_stores.map(callMethod('commitManaged')))

  // --- Operations ---

  const put = async (doc) => {
    if (!doc._id) {
      doc._id = prefix + makeId()
    }
    return connect().put(doc)
  }

  const remove = async (record) => connect().remove(getRecordDoc(record))

  // --- API ---

  const createStore = (storeOptions) =>
    createSvouchStore(
      {
        connect,
        put,
        lifecycle: addStore,
      },
      {
        autoCommit,
        accessors: schemaAdapter.getFields(schema),
        ...storeOptions,
      }
    )

  const col = {
    put,
    remove,

    commit,
    commitManaged,

    store: createStore,

    busy,
    dirty,
  }

  return col
}
