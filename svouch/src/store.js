import { readable, derived } from 'svelte/store'

import { noop, identity, minZero, pipe, callMethod } from './util.js'
import { lazy, deeplyLazy } from './util/store.js'

const paramsFields = ['sort', 'limit', 'skip']

const hasGreaterThanZeroSize = (x) => x.size > 0

const every = (predicate) => (values) => values.every(predicate)

const isTruthy = Boolean

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

const debounce = (fn, delay) => {
  if (delay === false || delay == null) return fn

  let lastArgs
  let timeout

  const run = () => fn(...lastArgs)

  const listener = (...args) => {
    lastArgs = args
    clearTimeout(timeout)
    timeout = setTimeout(run, delay)
  }

  listener.cancel = () => clearTimeout(timeout)

  return listener
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

export const createSvouchStore = (
  { connect, put, lifecycle },
  {
    accessors,

    autoCommit: initialAutoCommit = false,

    debounce: debounceDelay = 25,
    debounceEmpty: debounceEmptyDelay = 100,

    selector: initialSelector = {},
    fields: initialFields = undefined,
    sort = [{ _id: 'asc' }],
    limit = 0,
    skip = 0,
  }
) => {
  const autoCommit = lazy(initialAutoCommit)

  const isAutoCommit = derived(
    autoCommit,
    ($autoCommit) => $autoCommit !== false && $autoCommit != null
  )

  const isDeferredAutoCommit = derived(
    autoCommit,
    ($autoCommit) => typeof $autoCommit === 'number'
  )

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
      busyRecords.remove(record)
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
    updateDirty()
    updateBusy()
  }

  const unsetRecordDirty = (record, epoch) => {
    if (record.$$.epoch === epoch) {
      record.$$.dirty = false
      dirtyRecords.delete(record)
      updateDirty()
    }
    // NOTE we might still be dirty, but we've still just ended a request, so
    // maybe we're not busy anymore
    updateBusy()
  }

  const setDirty = (record) => {
    setRecordDirty(record)

    if (!isAutoCommit.value) return

    const commitRecord = () => saveManaged(record)

    if (isDeferredAutoCommit.value) {
      if (record.$$.commitTimeout) {
        clearTimeout(record.$$.commitTimeout)
      }
      record.$$.commitTimeout = setTimeout(commitRecord, autoCommit)
    } else {
      commitRecord()
    }
  }

  // --- Dirty / busy ---

  const updateDirty = noop
  const updateBusy = noop

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
    accessors && withAccessors(query, accessors, setDirty)
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
    })

    // -- Methods --
    //
    Object.assign(records, {
      ready: whenReady,
      commit: commitManaged,
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
      docs.set(newDocs)
      $feed.params = $params
    }
  })

  const liveFeedStarted = lazy(false)

  const docs = derived(
    liveFeed,
    ($feed, set) => {
      liveFeedStarted.set(false)

      const emptyTimeout = setTimeout(() => {
        set([])
        liveFeedStarted.set(true)
      }, debounceEmptyDelay)

      const listener = debounce((event, docs) => {
        clearTimeout(emptyTimeout)
        set(docs)
        liveFeedStarted.set(true)
      }, debounceDelay)

      $feed.on('update', listener)

      docs.set = set

      return () => {
        clearTimeout(emptyTimeout)
        if (listener.cancel) listener.cancel()
        $feed.removeListener('update', listener)
      }
    },
    []
  )

  const records = derived([liveFeed, docs], ([$liveFeed, $docs]) =>
    withApi($liveFeed, $docs.map(docToRecord))
  )

  // --- Ready ---

  const liveFeedReady = derived(
    liveFeed,
    ($feed, set) => {
      let canceled = false
      ready.value = false
      set(false)
      $feed.then(() => {
        if (canceled) return
        ready.value = true
        set(true)
      })
      return () => {
        canceled = true
      }
    },
    false
  )

  const ready = derived([liveFeedStarted, liveFeedReady], every(isTruthy))

  const readyListeners = []

  const whenReady = () => {
    if (ready.value) return Promise.resolve()
    return new Promise((resolve) => {
      readyListeners.push(resolve)
    })
  }

  // --- Dirty / busy ---

  const dirty = derived(dirtyRecords, hasGreaterThanZeroSize)

  const busy = derived(busyRecords, hasGreaterThanZeroSize)

  // ---

  const depStores = [paginator, isAutoCommit, isDeferredAutoCommit]

  const store = readable([], (set) => {
    const disposers = depStores.map(callMethod('subscribe', noop))

    let $records = []

    disposers.push(
      records.subscribe((recs) => {
        $records = recs
        set($records)
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
      ready.subscribe(($ready) => {
        if ($ready) {
          while (readyListeners.length > 0) {
            readyListeners.shift()()
          }
        }
      })
    )

    // prevent publishing negative values for skip / limit
    disposers.push(
      pagination.subscribe(() => {
        set($records)
      })
    )

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

    put,
  })

  return store
}
