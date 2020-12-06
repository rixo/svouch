/**
 * This index is the default entry point of the Svouch package. It is intended
 * as a battery-included reasonable default.
 *
 * It wraps our prebuilt PouchDB, and wires Superstruct as the schema engine.
 */

import { PouchDB, find, liveFind } from '@svouch/pouchdb'
import { Db as coreDb } from './core.js'

PouchDB.plugin(find)
PouchDB.plugin(liveFind)

const superstructAdapter = {
  getFields: ({ schema }) => schema,
}

export const Db = (opts) =>
  coreDb({
    PouchDB,

    schemaAdapter: superstructAdapter,

    ...opts,
  })
