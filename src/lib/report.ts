/** Logs a failure of work nothing waits on. */
export function report(promise: Promise<unknown>) {
  promise.catch((e) => console.error(e));
}
