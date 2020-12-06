import { writable, derived } from 'svelte/store'

import { identity, minZero, pipe } from './util.js'

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

const withState = doc => {
  const record = {}
  Object.defineProperty(record, '$$', {
    enumerable: false,
    value: { doc, dirty: false, error: null, epoch: 0 },
  })
  return record
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
  return record => {
    for (const key of keys) {
      wrap(record, key)
    }
    return record
  }
}

export const createSvouchStore = ({
  connect,
  put,
  setDirty,
  accessors,

  debounce: debounceDelay = 20,

  selector = {},
  sort = [{ _id: 'asc' }],
  limit = 0,
  skip = 0,
}) => {
  const params = {
    selector,
    sort,
    limit,
    skip,
  }

  const metaSpec = (field, livefeed, transform = identity) => ({
    get() {
      return params[field]
    },
    set(value) {
      const previous = params[field]
      if (value !== previous) {
        params[field] = transform(value)
      }
      docs.set(livefeed.paginate(params))
      return true
    },
  })

  const docToRecord = pipe(
    withState,
    accessors && withAccessors(accessors, setDirty)
  )

  const withParamsAccessors = (livefeed, docs) => {
    Object.defineProperties(docs, {
      sort: metaSpec('sort', livefeed),
      limit: metaSpec('limit', livefeed, minZero),
      skip: metaSpec('skip', livefeed, minZero),
      selector: {
        get() {
          return params.selector
        },
        set(value) {
          const field = 'selector'
          const previous = params[field]
          if (value !== previous) {
            params[field] = value
          }
          params[field] = value
          selector$.set(value)
          return true
        },
      },
    })
    return docs
  }

  const selector$ = writable({})

  const liveFeed = derived(selector$, ($selector, set) => {
    const changes = connect().liveFind({
      selector: $selector || {},
      ...params,
      aggregate: true,
    })
    set(changes)
    return () => {
      changes.cancel()
    }
  })

  const docs = derived(liveFeed, ($feed, set) => {
    const listener = debounce((event, docs) => set(docs), debounceDelay)

    $feed.on('update', listener)

    docs.set = set

    set([])

    return () => {
      $feed.removeListener('update', listener)
    }
  })

  const records = derived([liveFeed, docs], ([$liveFeed, $docs]) =>
    withParamsAccessors($liveFeed, $docs.map(docToRecord))
  )

  const store = derived(
    records,
    $records => {
      // apply pre subscribe (e.g. during component init) params
      store.set = value => {
        if (value !== $records) {
          Object.assign($records, value)
        }
      }
      return $records
    },
    []
  )

  store.put = put

  return store
}
