/** @type {import("snowpack").SnowpackUserConfig } */

// NOTE This is a dev facility... Either there's something I didn't get, or
// Snowpack won't pick up the changes in the `yarn link`'d package.
const LINK_SVOUCH = !!process.env.LINK_SVOUCH

module.exports = {
  mount: {
    public: '/',
    src: '/_dist_',
    ...(LINK_SVOUCH && {
      '../svouch': '/_svouch_',
    }),
  },
  plugins: ['@snowpack/plugin-svelte', '@snowpack/plugin-dotenv'],
  install: [
    /* ... */
  ],
  installOptions: {
    externalPacakge: ['svouch/pouch'],
  },
  devOptions: {
    open: 'none',
  },
  buildOptions: {
    /* ... */
  },
  proxy: {
    /* ... */
  },
  alias: {
    ...(LINK_SVOUCH && {
      svouch: '../svouch/index.js',
    }),
  },
}
