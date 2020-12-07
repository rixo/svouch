import { get } from 'svelte/store'
import objectid from 'objectid'

import { createCollection } from './collection.js'
import { callMethod, pipe } from './util.js'

const warnPendingBeforeUnload = ({
  isDirty,
  commit,
  commitOnUnload = false,
  warnBeforeUnload = !!commitOnUnload,
  pushError,
}) => {
  if (typeof window === 'undefined') return

  const event = 'beforeunload'

  const unloadListener = (e) => {
    window.removeEventListener(event, unloadListener)
    if (isDirty()) {
      if (commitOnUnload) {
        commit().catch(pushError(new Error('Failed to commit on unload')))
      }
      if (warnBeforeUnload) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
  }

  window.addEventListener(event, unloadListener)
}

const createDb = (opts = {}) => {
  const {
    // eslint-disable-next-line no-unused-vars
    name: dbName, // used by createPouch

    createPouch,

    schemaAdapter,

    commitOnUnload = false,
    warnBeforeUnload = !!commitOnUnload,

    makeId = objectid,
    autoConnect = false,
    autoCommit = false,
    logger = console,
    onError = (...args) => logger.error(...args),
  } = opts

  const collectionsByName = {}
  let collections = []

  function addCollection(name, col) {
    collectionsByName[name] = col
    collections = Object.values(collectionsByName)
  }

  let pouch
  let connect = () => {
    pouch = createPouch(opts)
    connect = () => pouch
    return pouch
  }

  // --- Error stream ---

  const pushError = (err) => {
    // TODO: push to db error stream
    console.error(err)
  }

  // --- Commit ---

  const commit = () => Promise.all(collections.map(callMethod('commit')))

  const isDirty = () => collections.some((col) => get(col.dirty))

  if (commitOnUnload || warnBeforeUnload) {
    warnPendingBeforeUnload({
      isDirty,
      commit,
      commitOnUnload,
      warnBeforeUnload,
      pushError,
    })
  }

  // --- API ---

  const collection = (colOptions) => {
    const { name } = colOptions

    if (collectionsByName[name]) {
      throw new Error(`Collection ${name} already loaded`)
    }

    const col = createCollection(db, {
      onError,
      makeId,
      autoCommit,
      schemaAdapter,
      ...colOptions,
    })

    addCollection(name, col)

    return col
  }

  const db = { connect, collection }

  // --- Auto connect ---

  if (autoConnect) {
    connect()
  }

  return db
}

export const Db = pipe(
  (options) => (typeof options === 'string' ? { name: options } : options),
  createDb
)
