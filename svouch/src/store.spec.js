import { test, describe } from 'zorax'

// import { get } from 'svelte/store'

import PouchDB from 'pouchdb-node'
import find from 'pouchdb-find'
import liveFind from 'pouchdb-live-find'
import memoryAdapter from 'pouchdb-adapter-memory'

import { createSvouchStore } from './store.js'

const getProp = (prop) => (o) => o[prop]

const callFn = (fn) => fn()

PouchDB.plugin(find)
PouchDB.plugin(liveFind)
PouchDB.plugin(memoryAdapter)

let i = 0

const createPouch = () => {
  const db = new PouchDB('svouch-test-' + ++i, { adapter: 'memory' })

  const connect = () => db

  let lastId = 0

  const put = (doc) =>
    db.put({
      _id: 'test/' + ++lastId,
      ...doc,
    })

  const count = () => db.allDocs().then((res) => res.total_rows)

  const all = () =>
    db
      .allDocs({ include_docs: true })
      .then(({ rows }) => rows.map((row) => row.doc))

  return { db, connect, put, count, all }
}

const withPouch = async function zora_spec_fn(t, handler) {
  const pouch = createPouch()
  await handler(t, pouch)
  await pouch.db.destroy()
}

test('sanity: test pouchdb', withPouch, async (t, { db, put }) => {
  await put({ _id: 'foo' })

  const res = await db.allDocs({ include_docs: true })

  t.eq(res.total_rows, 1)
  t.eq(res.rows.length, 1)
  t.eq(res.rows[0].id, 'foo')
})

describe('operations', () => {
  test('put', withPouch, async (t, pouch) => {
    const lifecycle = () => () => {}

    const store = createSvouchStore(
      { ...pouch, lifecycle },
      {
        accessors: ['value'],
        debounce: false,
      }
    )

    await pouch.put({ value: 'foo' })
    await pouch.put({ value: 'bar' })

    let $store

    const cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar'])

    cancel()
  })

  test('commit', withPouch, async (t, pouch) => {
    const store = createSvouchStore(pouch, {
      accessors: ['value'],
      debounce: false,
    })

    await pouch.put({ value: 'foo' })
    await pouch.put({ value: 'bar' })

    let $store
    let cancel

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar'])
    t.eq($store[0].value, 'foo')

    $store[0].value = 'foot'
    // store.commit()

    cancel()

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar'])

    $store[0].value = 'foot'
    store.commit()

    cancel()

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foot', 'bar'])

    cancel()
  })

  test('commit', withPouch, async (t, pouch) => {
    const store = createSvouchStore(pouch, {
      accessors: ['value'],
      debounce: false,
    })

    await pouch.put({ value: 'foo' })
    await pouch.put({ value: 'bar' })

    let $store
    let cancel

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar'])
    t.eq($store[0].value, 'foo')

    $store[0].value = 'foobar'

    cancel()

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq(
      $store.map(getProp('value')),
      ['foo', 'bar'],
      'value is not persisted if not commited'
    )

    $store[0].value = 'foot'
    store.commit()

    cancel()

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq(
      $store.map(getProp('value')),
      ['foot', 'bar'],
      'value is persisted after commit'
    )
  })
})

describe('params', () => {
  test('sort, limit, skip', withPouch, async (t, pouch) => {
    const store = createSvouchStore(pouch, {
      accessors: ['value'],
      debounce: false,
    })

    await pouch.put({ value: 'foo' })
    await pouch.put({ value: 'bar' })
    await pouch.put({ value: 'baz' })

    let $store

    const cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar', 'baz'])

    $store.sort = [{ _id: 'desc' }]

    t.eq($store.map(getProp('value')), ['baz', 'bar', 'foo'])

    $store.limit = 2

    t.eq($store.map(getProp('value')), ['baz', 'bar'])

    $store.skip = 1

    t.eq($store.map(getProp('value')), ['bar', 'foo'])

    cancel()
  })

  test('fields', withPouch, async (t, pouch) => {
    const store = createSvouchStore(pouch, {
      accessors: ['value', 'x'],
      debounce: false,
    })

    await pouch.put({ value: 'foo', x: 41 })
    await pouch.put({ value: 'bar', x: 42 })
    await pouch.put({ value: 'baz', x: 43 })

    let $store

    const cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq(
      [...$store],
      [
        { value: 'foo', x: 41 },
        { value: 'bar', x: 42 },
        { value: 'baz', x: 43 },
      ]
    )

    $store.fields = ['x']

    await $store.ready()

    t.eq([...$store], [{ x: 41 }, { x: 42 }, { x: 43 }])

    $store.fields = ['value']

    await $store.ready()

    t.eq([...$store], [{ value: 'foo' }, { value: 'bar' }, { value: 'baz' }])

    cancel()
  })

  test('selector', withPouch, async (t, pouch) => {
    const store = createSvouchStore(pouch, {
      accessors: ['value'],
      debounce: false,
    })

    await pouch.put({ value: 'foo' })
    await pouch.put({ value: 'bar' })
    await pouch.put({ value: 'baz' })

    let $store

    const cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar', 'baz'])

    $store.selector = { value: { $regex: '^b' } }

    await $store.ready()

    t.eq($store.map(getProp('value')), ['bar', 'baz'])

    $store.limit = 1

    t.eq($store.map(getProp('value')), ['bar'])

    $store.selector = {}
    $store.limit = 0

    await $store.ready()

    t.eq($store.map(getProp('value')), ['foo', 'bar', 'baz'])

    cancel()
  })
})

describe('sub stores', () => {
  test('dirty', withPouch, async (t, pouch) => {
    const store = createSvouchStore(pouch, {
      accessors: ['value'],
      debounce: false,
    })

    await pouch.put({ value: 'foo' })
    await pouch.put({ value: 'bar' })

    let $store
    let $dirty
    let $busy

    let cancel

    cancel = store.subscribe((x) => {
      $store = x
    })

    const disposers = [
      store.dirty.subscribe((x) => {
        $dirty = x
      }),
      store.busy.subscribe((x) => {
        $busy = x
      }),
    ]

    await $store.ready()

    t.notOk($dirty, 'is not initially dirty')
    t.notOk($busy, 'is not initially busy')

    $store[0].value = 'foot'

    t.ok($dirty, 'is dirty after a record is modified')
    t.notOk($busy, 'is not busy after a record is modified')

    cancel()

    t.ok($dirty, 'remains dirty when the store has no subscribers')
    t.notOk($busy, 'is not busy when the store has no subscribers')

    cancel = store.subscribe((x) => {
      $store = x
    })

    await $store.ready()

    $store[0].value = 'foot'

    store.commit()

    t.ok($busy, 'is busy while a record is being saved')

    cancel()

    t.skip('TODO: needs idle')

    // cancel = store.subscribe((x) => {
    //   $store = x
    // })
    //
    // await $store.ready()
    //
    // t.eq($store.map(getProp('value')), ['foot', 'bar'])
    //
    // cancel()

    disposers.forEach(callFn)
  })
})
