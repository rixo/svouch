import PouchDB from 'pouchdb-browser'
import find from 'pouchdb-find'
import liveFind from 'pouchdb-live-find'

PouchDB.plugin(find)
PouchDB.plugin(liveFind)

export { PouchDB, find, liveFind }
