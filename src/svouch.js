import { PouchDB } from 'svouch'
import { writable, readable } from 'svelte/store'
import objectid from 'objectid'

const noop = () => {}

const call = (x, f) => f(x)

const pipe = (...fns) => {
  fns = fns.filter(Boolean)
  return (x0) => fns.reduce(call, x0)
}

const withAccessors = (keys, setDirty) => {
  const wrap = (record, key) => {
    Object.defineProperty(record, key, {
      get() {
        return record.$$.doc[key]
      },
      set(value) {
        record.$$.doc[key] = value
        setDirty(record)
        return true
      },
    })
  }
  return (record) => {
    for (const key of keys) {
      wrap(record, key)
    }
    return record
  }
}

const withState = (doc) => {
  const record = { ...doc }
  Object.defineProperty(record, '$$', {
    enumerable: false,
    value: { doc, dirty: false, error: null, epoch: 0 },
  })
  return record
}

const isBusyRecord = (rec) => rec.$$.saving

const warnPendingBeforeUnload = ({ commitManaged }) => {
  if (typeof window === 'undefined') return

  const event = 'beforeunload'

  const unloadListener = (e) => {
    window.addEventListener(event, unloadListener)
    if (commitManaged() !== false) {
      e.preventDefault()
      e.returnValue = ''
    }
  }

  window.addEventListener(event, unloadListener)
}

export const createWritableStore = ({ connect, put, setDirty, accessors }) => {
  const aggregateToRecords = pipe(
    withState,
    accessors && withAccessors(accessors, setDirty)
  )

  const store = writable([], (set) => {
    const changes = connect()
      .liveFind({
        selector: {},
        sort: [{ _id: 'asc' }],
        aggregate: true,
      })
      .on('update', (update, aggregate) => {
        const records = aggregate.map(aggregateToRecords)
        // set(withMeta(records))
        set(records)
      })

    return () => {
      changes.cancel()
    }
  })

  store.put = put

  return store
}

const createCollection = (
  { connect },
  { name, schema, autoCommit, onError, makeId }
) => {
  const prefix = name + '/'

  const isAutoCommit = autoCommit !== false && autoCommit != null

  const isDeferredAutoCommit = typeof autoCommit === 'number'

  const dirtyRecords = new Set()

  let updateDirty = noop
  let updateBusy = noop

  // --- Save ---

  const save = async (record) => {
    if (!record.$$.dirty) return
    try {
      const epoch = ++record.$$.epoch
      if (record.$$.saving) await record.$$.saving
      record.$$.saving = put(record.$$.doc)
      await record.$$.saving
      record.$$.saving = null
      record.$$.error = null
      unsetRecordDirty(record, epoch)
    } catch (err) {
      record.$$.saving = null
      record.$$.error = err
      throw err
    }
  }

  const saveManaged = async (record) =>
    await save(record).catch((err) => {
      onError('Failed to save record', record, err)
    })

  // save (put) all remaining dirty records
  const commitWith = (saveFn) => () => {
    if (dirtyRecords.size === 0) return false
    return Promise.all([...dirtyRecords].map(saveFn))
  }

  const commit = commitWith(save)

  const commitManaged = commitWith(saveManaged)

  // --- Dirty / busy ---

  const isDirty = () => dirtyRecords.size > 0

  const isBusy = () => [...dirtyRecords].some(isBusyRecord)

  const setRecordDirty = (record) => {
    record.$$.dirty = true
    dirtyRecords.add(record)
    updateDirty()
    updateBusy()
  }

  const unsetRecordDirty = (record, epoch) => {
    if (record.$$.epoch === epoch) {
      record.$$.dirty = false
      dirtyRecords.delete(record)
      updateDirty()
    }
    updateBusy()
  }

  const dirty$ = readable(false, (set) => {
    updateDirty = () => set(isDirty())
    return () => {
      updateDirty = noop
    }
  })

  const busy$ = readable(false, (set) => {
    updateBusy = () => set(isBusy())
    return () => {
      updateBusy = noop
    }
  })

  const setDirty = (record) => {
    setRecordDirty(record)

    if (!isAutoCommit) return

    const commitRecord = () => saveManaged(record)

    if (isDeferredAutoCommit) {
      if (record.$$.commitTimeout) {
        clearTimeout(record.$$.commitTimeout)
      }
      record.$$.commitTimeout = setTimeout(commitRecord, autoCommit)
    } else {
      commitRecord()
    }
  }

  // --- API ---

  const createWritable = (storeOptions) => {
    const store = createWritableStore({
      connect,
      put,
      setDirty,
      accessors: Object.keys(schema.schema),
      ...storeOptions,
    })

    Object.assign(store, {
      dirty: dirty$,
      busy: busy$,
      commitManaged,
      removeRecord: (record) => () => removeManaged(record),
    })

    return store
  }

  const put = async (doc) => {
    if (!doc._id) {
      doc._id = prefix + makeId()
    }
    return connect().put(doc)
  }

  const getDoc = (record) => record.$$.doc

  const remove = async (record) => connect().remove(getDoc(record))

  const removeManaged = async (record) => {
    try {
      return await remove(record)
    } catch (err) {
      onError('Failed to remove record', record, err)
    }
  }

  const col = {
    put,
    remove,

    commit,
    commitManaged,

    writable: createWritable,

    busy: busy$,
    dirty: dirty$,
  }

  return col
}

const createDb = ({
  name: dbName,
  makeId = objectid,
  autoConnect = false,
  autoCommit = 1000,
  beforeunload = true,
  logger = console,
  onError = (...args) => logger.error(...args),
} = {}) => {
  const collections = {}

  let pouch
  let connect = () => {
    pouch = new PouchDB(dbName)
    connect = () => pouch
    return pouch
  }

  const commitManaged = () => {
    const promises = Object.values(collections)
      .map((col) => col.commitManaged())
      .filter(Boolean)
    if (promises.length > 0) return Promise.all(promises)
    return false
  }

  if (beforeunload) {
    warnPendingBeforeUnload({ commitManaged })
  }

  const collection = (colOptions) => {
    const { name } = colOptions

    if (collections[name]) {
      throw new Error(`Collection ${name} already loaded`)
    }

    const col = createCollection(db, {
      onError,
      makeId,
      autoCommit,
      ...colOptions,
    })

    collections[name] = col

    return col
  }

  if (autoConnect) {
    connect()
  }

  const db = { connect, collection }

  return db
}

export const Db = pipe(
  (options) => (typeof options === 'string' ? { name: options } : options),
  createDb
)
