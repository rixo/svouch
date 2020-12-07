This is a design doc for now.

Once API is somewhat stabilized, this will move to README.

```js
import { Db } from 'svouch'

export const db = Db('my-db', {})

db.collection('todos', {
  schema: {
    text: s.string(),
  },
})

db.collection('users', {
  schema: {
    name: s.string(),
  },
})

export const todos = db.collection('todos').store({
  autoCommit: 1000,
  exposeDirtyBusy: true,
})
```

```js
const col = db.collection('todos')

col.put({ text: 'remember the milk' })

col.put({
  _id: '...',
  _rev: '...',
  text: 'forget about the milk',
})
```

```html
<script>
  import { db, todos } from './db.js'

  // dirty / busy state cascade up from (active) stores to collections, to db

  const { dirty, busy } = db

  $: console.log($dirty)
  $: console.log($busy)

  // dirty / busy are separate stores because they can change often, and we
  // don't necessarily want to notify the whole store (mainly exposing docs)
  // every time dirty / busy changes

  $: todos_dirty = todos.dirty
  $: todos_busy = todos.busy

  $: console.log($todos_dirty)
  $: console.log($todos_busy)

  // selector, sort, limit, and skip are attached to the store's value (i.e.
  // $todos) by default, because we can be sure that when one of those change
  // the docs will also change in most cases

  $: console.log($todos.selector)
  $: console.log($todos.sort)
  $: console.log($todos.limit)
  $: console.log($todos.skip)
</script>

...
```
