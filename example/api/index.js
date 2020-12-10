/* eslint-env node */

const PouchDB = require('pouchdb')
const express = require('express')
const app = express()

app.use('/db', require('express-pouchdb')(PouchDB))

module.exports = app
