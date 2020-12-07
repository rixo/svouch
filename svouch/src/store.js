import { readable, derived } from 'svelte/store'

import { noop, identity, minZero, pipe, callMethod } from './util.js'
import { lazy, deeplyLazy, transform } from './util/store.js'

const paramsFields = ['sort', 'limit', 'skip']

const isRecordBusy = (record) => record.$$.saving

const debounce = (fn, delay) => {
  if (delay === false || delay == null) return fn

  let lastArgs
  let timeout

  const run = () => fn(...lastArgs)

  return (...args) => {
    lastArgs = args
    clearTimeout(timeout)
    timeout = setTimeout(run, delay)
  }
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

export const createSvouchStore = (
  { connect, put, lifecycle },
  {
    accessors,

    autoCommit: initialAutoCommit = false,

    debounce: debounceDelay = 20,

    selector: initialSelector = {},
    fields: initialFields = undefined,
    sort = [{ _id: 'asc' }],
    limit = 0,
    skip = 0,
  }
) => {
  const dirtyRecords = new Set()

  const autoCommit = lazy(initialAutoCommit)

  const isAutoCommit = derived(
    autoCommit,
    ($autoCommit) => $autoCommit !== false && $autoCommit != null
  )

  const isDeferredAutoCommit = derived(
    autoCommit,
    ($autoCommit) => typeof $autoCommit === 'number'
  )

  // --- Error stream ---

  const pushError = (err) => {
    // TODO add error to error stream
  }

  const managed = (fn) => (...args) => fn(...args).catch(pushError)

  // --- Save ---

  const save = async (record) => {
    if (!record.$$.dirty) return
    try {
      const epoch = ++record.$$.epoch
      // WARNING don't await unconditionnally -- the function needs to be sync
      // until it sets the $$.saving flag
      if (record.$$.saving) {
        await record.$$.saving
      }
      if (!record.$$.dirty) return
      record.$$.saving = put(record.$$.doc)
      updateBusy()
      await record.$$.saving
      record.$$.saving = null
      record.$$.error = null
      unsetRecordDirty(record, epoch)
    } catch (err) {
      record.$$.saving = null
      record.$$.error = err
      updateBusy()
      throw err
    }
  }

  const saveManaged = managed(save)

  // --- Commit ---

  // const commit = () => Promise.all([...dirtyRecords].map(save))

  const commitManaged = () => Promise.all([...dirtyRecords].map(saveManaged))

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

  let updateDirty = noop
  let updateBusy = noop

  const isDirty = () => dirtyRecords.size > 0

  const isBusy = () => {
    for (const record of dirtyRecords) {
      if (isRecordBusy(record)) return true
    }
    return false
  }

  const dirty = lazy(false, (set) => {
    updateDirty = () => set(isDirty())
    updateDirty()
    return () => {
      updateDirty = noop
    }
  })

  const busy = lazy(false, (set) => {
    updateBusy = () => set(isBusy())

    updateBusy()

    return () => {
      updateBusy = noop
    }
  })

  // --- Feed & docs ---

  const pagination = transform(
    lazy({
      sort,
      limit,
      skip,
    }),
    // ensure we only get valid params in the store
    ({ sort, limit, skip }) => ({
      ...pagination.value,
      sort,
      limit: limit && minZero(limit),
      skip: skip && minZero(skip),
    })
  )

  const query = deeplyLazy({
    selector: initialSelector,
    fields: initialFields,
  })

  const docToRecord = pipe(
    withState,
    accessors && withAccessors(query, accessors, setDirty)
  )

  const paginationAccessor = (field, livefeed, transform = identity) => ({
    get() {
      return pagination.value[field]
    },
    set(value) {
      pagination.update(($params) => ({
        ...$params,
        [field]: transform(value),
      }))
      return true
    },
  })

  const queryAccessor = (field) => ({
    get() {
      return query.value[field]
    },
    set(value) {
      query.update(($query) => ({
        ...$query,
        [field]: value,
      }))
      // query.set({
      //   ...query.value,
      //   [field]: value,
      // })
      return true
    },
  })

  const withParamsAccessors = (liveFeed, records) => {
    Object.defineProperties(records, {
      sort: paginationAccessor('sort', liveFeed),
      limit: paginationAccessor('limit', liveFeed, minZero),
      skip: paginationAccessor('skip', liveFeed, minZero),

      selector: queryAccessor('selector'),
      fields: queryAccessor('fields'),

      // selector: {
      //   get() {
      //     return query.value.selector
      //   },
      //   set(value) {
      //     const field = 'selector'
      //     const previous = pagination.value[field]
      //     if (value !== previous) {
      //       pagination.value[field] = value
      //     }
      //     pagination.value[field] = value
      //     query.update((x) => ({
      //       ...x,
      //       selector: value,
      //     }))
      //     return true
      //   },
      // },

      ready: {
        get() {
          return liveFeed.then
        },
      },
    })
    return records
  }

  // recreate feed when selector change
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

  const docs = derived(
    liveFeed,
    ($feed, set) => {
      const listener = debounce((event, docs) => {
        // console.log('set >>', docs)
        return set(docs)
      }, debounceDelay)

      $feed.on('update', listener)

      docs.set = set

      return () => {
        $feed.removeListener('update', listener)
      }
    },
    []
  )

  const records = derived([liveFeed, docs], ([$liveFeed, $docs]) =>
    withParamsAccessors($liveFeed, $docs.map(docToRecord))
  )

  // const store = derived(
  //   [records, paginator, isAutoCommit, isDeferredAutoCommit],
  //   ([$records]) => {
  //     // apply pre subscribe (e.g. during component init) params
  //     store.set = (value) => {
  //       if (value !== $records) {
  //         Object.assign($records, value)
  //       }
  //     }
  //     return $records
  //   },
  //   []
  // )

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
      if (isAutoCommit.value) {
        await commitManaged()
      }
      await Promise.all([...dirtyRecords].map(({ $$ }) => $$.saving))
      dirtyRecords.clear()
    })

    if (lifecycle) {
      disposers.push(lifecycle(store))
    }

    store.set = (value) => {
      // apply pre subscribe (e.g. during component init) params
      if (value !== $records) {
        Object.assign($records, value)
      }
    }

    set($records)

    return pipe(...disposers)
  })

  Object.assign(store, {
    dirty,
    busy,

    commit: commitManaged,
    // raw: { commit },

    put,
  })

  return store
}
