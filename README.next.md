# Svouch

> The power of PouchDB in the power of Svelte. :exploding_head:

## What's this?

Basically, a dumbed down [RxDB](https://rxdb.info/) with Svelte stores instead of RxJS. I loved using RxDB in a Svelte project of mine some time ago, everything seemed to work so perfectly together... But the few hundreds lines of code of Svelte's stores and a little smarts can probably get you nearly as far as RxJS, but with 1 MB in the browser, and 600 pages of doc, less (full disclosure: didn't check any of those numbers).

## Features

Svouch aims to provide 3 goodies:

**A prebuilt browser-ready ES modules version of PouchDB ([@svouch/pouchdb](https://www.npmjs.com/package/@svouch/pouchdb)).**

That's what you need to be able to just `npm install` & run in most Svelte project setups (Rollup, Snowpack, Vite, Webpack...).

PouchDB and/or some of its plugins might not be straightforward to add to a build config otherwise, and you'd often had to butcher your existing config (plugins for Node builtins...) for them.

For now, this includes plugins `pouchdb-find` and `pouchdb-live-find` because they are required by Svouch's core. But the plan would be to add any meaningful plugin that proves recalcitrant to plug & play.

**A (very) thin Db / Collection abstraction layer over PouchDB.**

This helps you initialize and share resources (PouchDB databases...), cascade defaults (auto commit...).

It also implements a bare schema validation, and a collection scheme, to let use PouchDB more like a normal database and without having to worry about `_id`s too much if you don't want to.

**Svouch's mighty persisting, PouchDB-backed, Svelte-tailored store**

It aims to act as much as possible as a normal writable store, except it persists in PouchDB. And it syncs too!

Each store instance acts as its own data cache for a given view / slice of your Pouch database, with auto or deferred commit capacities. But they can be plugged to the same Pouch database for maximal effect, and have their changes propagated to others instances via Pouch.

Well, that was maximal effect but only until you start streaming all this data real-time to your servers and stuff. 'cause PouchDB can sync! And Svelte can stream, they're a match made in heaven!

The concept of Svouch's stores is to wrap the functionalities of [pouchdb-live-find](https://github.com/colinskow/pouchdb-live-find#basic-usage) into a lovely declarative-friendly stream (i.e. the store itself -- Svelte's stores, Node's streams, Observables... they're really all streams to me), tailed for optimal comfort with Svelte's syntax.

You can write / bind to the feed's params (limit, skip...), or to the fields of docs (e.g. used in a `{#each}` loop), and commit automatically or when you see fit. You can `{#await}` for the feed to be ready, and also `{#catch}` loading errors directly in the markup this way.

Although designed to work together, those 3 parts are independent. You can use them individually, or in any combination.
