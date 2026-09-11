/**
 * Returns a function that only invokes `fn` after `wait` ms of quiet time.
 * Used to debounce admin search inputs (B32) so filters don't re-query
 * PostgREST on every keystroke.
 */
export function debounce(fn, wait = 300) {
  if (typeof fn !== "function") throw new Error("debounce() needs a function");
  let timer = null;
  let pendingArgs;
  let pendingThis;
  const wrapped = function (...args) {
    pendingArgs = args;
    pendingThis = this;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(pendingThis, pendingArgs);
    }, wait);
  };
  wrapped.cancel = function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return wrapped;
}