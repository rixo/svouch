export const identity = (x) => x

export const minZero = (x) => Math.max(0, x)

export const noop = () => {}

export const call = (x, f) => f(x)

export const pipe = (...fns) => {
  fns = fns.filter(Boolean)
  return (x0) => fns.reduce(call, x0)
}
