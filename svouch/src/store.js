import { readable, derived } from 'svelte/store'

import { noop, identity, minZero, pipe, callMethod } from './util.js'
import { lazy, deeplyLazy, debounced, listening } from './util/store.js'

const paramsFields = ['sort', 'limit', 'skip']

const hasGreaterThanZeroSize = (x) => x.size > 0

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  }).finally(() => {
    o.resolved = true
  })
  const o = { promise, resolve, reject, resolved: false }
  return o
}

const storeSet = (initial) => {
  const value = new Set(initial)

  let cachedValues

  let set

  const store = readable(value, (_set) => {
    set = _set
    return () => {
      set = null
    }
  })

  const values = () => {
    if (!cachedValues) cachedValues = [...value]
    return cachedValues
  }

  const mutate = (fn) => (x) => {
    const sizeBefore = value.size
    fn(x)
    if (sizeBefore !== value.size) {
      cachedValues = null
      if (set) set(value)
    }
  }

  store.add = mutate((x) => value.add(x))

  store.delete = mutate((x) => value.delete(x))

  store.clear = mutate(() => value.clear())

  store.map = (...args) => values().map(...args)

  return store
}

const withState = (doc) => {
  const record = {}
  Object.defineProperty(record, '$$', {
    enumerable: false,
    value: { doc, dirty: false, error: null, epoch: 0 },
  })
  return record
}

const withAccessors = (query, keys, setDirty) => {
  const wrapKey = (record, key) => {
    Object.defineProperty(record, key, {
      enumerable: true,
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

  let lastQuery
  let cachedKeys

  const filterKeys = () =>
    query.value.fields
      ? keys.filter((key) => query.value.fields.includes(key))
      : keys

  const getKeys = () => {
    if (query.value === lastQuery) return cachedKeys
    cachedKeys = filterKeys()
    lastQuery = query.value
    return cachedKeys
  }

  return (record) => {
    for (const key of getKeys()) {
      wrapKey(record, key)
    }
    return record
  }
}

const paramAccessor = (field, store, transform = identity) => ({
  get() {
    return store.value[field]
  },
  set(value) {
    const transformed = transform(value)
    const force = transformed !== value
    store.update(
      ($params) => ({
        ...$params,
        [field]: transformed,
      }),
      force
    )
    return true
  },
})

const mergeAccessors = (...sources) => sources.filter(Boolean).flat()

export const createSvouchStore = (
  { connect, put, remove, lifecycle },
  {
    accessors,
    defaultAccessors = ['_id'],

    autoCommit: initialAutoCommit = false,

    debounce = 250,
    debounceReady = debounce, // debounce ready state (~loading)
    debounceEmpty = debounce, // debounce empty state

    selector: initialSelector = {},
    fields: initialFields = undefined,
    sort = [{ _id: 'asc' }],
    limit = 0,
    skip = 0,
  }
) => {
  // --- Auto commit ---

  const autoCommit = lazy(initialAutoCommit)

  const isAutoCommit = derived(autoCommit, ($autoCommit) => {
    return (isAutoCommit.value = $autoCommit !== false && $autoCommit != null)
  })

  const isDeferredAutoCommit = derived(autoCommit, ($autoCommit) => {
    return (isDeferredAutoCommit.value = typeof $autoCommit === 'number')
  })

  // --- Dirty records ---

  const dirtyRecords = storeSet()

  const busyRecords = storeSet()

  // --- Error stream ---

  const pushError = (err) => {
    // TODO add error to error stream
  }

  const managed = (fn) => (...args) => fn(...args).catch(pushError)

  // --- Save ---

  const save = async (record) => {
    if (!record.$$.dirty) return
    busyRecords.add(record)
    try {
      const epoch = ++record.$$.epoch
      // WARNING don't await unconditionnally -- the function needs to be sync
      // until it sets the $$.saving flag
      if (record.$$.saving) {
        await record.$$.saving
      }
      if (!record.$$.dirty) return
      record.$$.saving = put(record.$$.doc)
      await record.$$.saving
      record.$$.error = null
      unsetRecordDirty(record, epoch)
    } catch (err) {
      record.$$.error = err
      throw err
    } finally {
      record.$$.saving = null
      busyRecords.delete(record)
    }
  }

  const saveManaged = managed(save)

  // --- Commit ---

  // const commit = () => Promise.all([...dirtyRecords].map(save))

  const commitManaged = () => {
    return Promise.all(
      dirtyRecords.map((x) => {
        return saveManaged(x)
      })
    )
  }

  // --- Auto commit ---

  const setRecordDirty = (record) => {
    record.$$.dirty = true
    dirtyRecords.add(record)
  }

  const unsetRecordDirty = (record, epoch) => {
    if (record.$$.epoch !== epoch) return
    record.$$.dirty = false
    dirtyRecords.delete(record)
  }

  const setDirty = (record) => {
    setRecordDirty(record)

    if (!isAutoCommit.value) return

    const commitRecord = () => saveManaged(record)

    if (isDeferredAutoCommit.value) {
      if (record.$$.commitTimeout) {
        clearTimeout(record.$$.commitTimeout)
      }
      record.$$.commitTimeout = setTimeout(commitRecord, autoCommit.value)
    } else {
      commitRecord()
    }
  }

  // --- Feed & docs ---

  const pagination = deeplyLazy({
    sort,
    limit,
    skip,
  })

  const query = deeplyLazy({
    selector: initialSelector,
    fields: initialFields,
  })

  const docToRecord = pipe(
    withState,
    accessors &&
      withAccessors(query, mergeAccessors(defaultAccessors, accessors), setDirty)
  )

  const withApi = (liveFeed, records) => {
    // -- Params --
    //
    Object.defineProperties(records, {
      // query
      selector: paramAccessor('selector', query),
      fields: paramAccessor('fields', query),
      // pagination
      sort: paramAccessor('sort', pagination),
      limit: paramAccessor('limit', pagination, minZero),
      skip: paramAccessor('skip', pagination, minZero),

      // docs: {
      //   get() {
      //     return docsPromise.value
      //   },
      //   set() {
      //     throw new Error('Cannot write to $store.docs')
      //   },
      // },

      // ready: {
      //   get() {
      //     return readyPromise.value
      //   },
      //   set() {
      //     throw new Error('Cannot write to $store.ready')
      //   },
      // },
    })

    // -- Methods --
    //
    Object.assign(records, {
      whenReady,
      ready: readyDeferred.promise,
      commit: commitManaged,

      put(doc) {
        return put(doc).catch(pushError)
      },

      remove(record) {
        busyRecords.add(record)
        return remove(record)
          .then(() => {
            dirtyRecords.delete(record)
          })
          .catch(pushError)
          .finally(() => {
            busyRecords.delete(record)
          })
      },
    })

    return records
  }

  // recreate feed when selector or query changes
  const liveFeed = derived(query, ($query, set) => {
    const { selector, fields } = $query

    const changes = connect().liveFind({
      ...pagination.value,
      selector,
      fields,
      aggregate: true,
    })

    changes.params = pagination.value

    set(changes)

    return () => {
      changes.cancel()
    }
  })

  // paginate feed when params change
  const paginator = derived([liveFeed, pagination], ([$feed, $params]) => {
    if (
      $feed.params !== $params &&
      paramsFields.some((field) => $feed.params[field] !== $params[field])
    ) {
      const newDocs = $feed.paginate($params)
      $feed.params = $params
      $feed.emit('update', null, newDocs)
    }
  })

  const docs = listening(liveFeed, 'update', [], (event, docs) => docs)

  const debouncedDocs = debounced(
    docs,
    debounceEmpty,
    [],
    ($x) => $x.length === 0
  )

  const records = derived([liveFeed, debouncedDocs], ([$liveFeed, $docs]) =>
    withApi($liveFeed, $docs.map(docToRecord))
  )

  // --- Ready ---

  const liveFeedReady = listening(liveFeed, 'ready', false, () => true)

  const ready = debounced(liveFeedReady, debounceReady, false)

  const readyListeners = []

  const whenReady = () => {
    if (liveFeedReady.value) return Promise.resolve()
    return new Promise((resolve) => {
      readyListeners.push(resolve)
    })
  }

  // --- Dirty / busy ---

  const dirty = derived(dirtyRecords, hasGreaterThanZeroSize)

  const busy = derived(busyRecords, hasGreaterThanZeroSize)

  // ---

  const depStores = [paginator, isAutoCommit, isDeferredAutoCommit]

  // const docsPromise = derived([ready, records], ([$ready, $records], set) => {
  //   const next = $ready ? Promise.resolve($records) : never
  //   clearTimeout(docsPromise.timeout)
  //   if (next === never && debounce !== false) {
  //     docsPromise.timeout = setTimeout(() => {
  //       set((docsPromise.value = next))
  //     }, debounce)
  //   } else {
  //     set((docsPromise.value = next))
  //   }
  // })
  //
  // docsPromise.value = never
  //
  // const readyPromise = derived([ready], ([$ready], set) => {
  //   readyPromise.value = $ready ? Promise.resolve() : never
  //   set(readyPromise.value)
  // })
  //
  // readyPromise.value = never

  let readyDeferred = deferred()

  const readyPromise = derived(
    ready,
    ($ready, set) => {
      if ($ready) {
        readyDeferred.resolve()
      } else if (readyDeferred.resolved) {
        readyDeferred = deferred()
        set(readyDeferred.promise)
      }
    },
    readyDeferred.promise
  )

  const store = readable([], (set) => {
    const disposers = depStores.map(callMethod('subscribe', noop))

    let $records = []

    const notify = () => {
      set($records)
    }

    disposers.push(
      records.subscribe((recs) => {
        $records = recs
        notify()
      })
    )

    disposers.push(
      readyPromise.subscribe(($readyPromise) => {
        if ($records.ready === $readyPromise) return
        $records.ready = $readyPromise
        notify()
      })
    )

    // when auto commit is enabled, commit all pending records
    disposers.push(
      isAutoCommit.subscribe((auto) => {
        if (auto) commitManaged()
      })
    )

    disposers.push(async () => {
      // commit pending records if auto commit is on
      if (isAutoCommit.value) {
        await commitManaged()
      }

      // wait for busy records to finish operations
      while (busyRecords.size > 0) {
        await Promise.all(busyRecords.map(({ $$ }) => $$.saving))
      }

      // clear dirty / busy records
      dirtyRecords.clear()
      busyRecords.clear()
    })

    disposers.push(
      liveFeedReady.subscribe(($ready) => {
        if ($ready) {
          while (readyListeners.length > 0) {
            readyListeners.shift()()
          }
        }
      })
    )

    // FIXME this shouldn't be needed?
    // prevent publishing negative values for skip / limit
    disposers.push(pagination.subscribe(notify))

    if (lifecycle) {
      disposers.push(lifecycle(store))
    }

    // API

    store.set = (value) => {
      // apply pre subscribe (e.g. during component init) params
      if (value !== $records) {
        Object.assign($records, value)
      }
    }

    // Init

    set($records)

    return pipe(...disposers)
  })

  Object.assign(store, {
    dirty,
    busy,
  })

  return store
}
