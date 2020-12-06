# @svouch/pouchdb

This is a prebuilt browser-ready version of PouchDB, as well as `pouchdb-find` and `pouchdb-live-find` plugins in ES module, in use in Svouch.

The reason this exists is that Svouch relies on those plugins, and they can be a little daunting to build with Rollup or no-bundlers (e.g. Snowpack, Vite...) because they're using node builtins, etc.

This package is a convenience to be able to use PouchDB in the browser easily, without having to butcher your build config.

```js
import { PouchDB, find, liveFind } from '@svouch/pouchdb'

PouchDB.plugin(find)
PouchDB.plugin(liveFind)

// do something with PouchDB!
```
