export const identity = (x) => x

export const minZero = (x) => Math.max(0, x)

export const noop = () => {}

export const call = (x, f) => f(x)

export const callMethod = (method, ...args) => (o) => o[method](...args)

export const pipe = (...fns) => {
  fns = fns.filter(Boolean)
  return (x0) => fns.reduce(call, x0)
}

export const isDeferredAutoCommit = (autoCommit) =>
  typeof autoCommit === 'number'
