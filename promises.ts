/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export class UnexpectedResolveError extends Error {}

export function sleep(millis: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    function done() {
      clearTimeout(timeoutHandle)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done)
    const timeoutHandle = setTimeout(done, millis)
  })
}

export function periodically(
  func: () => Promise<unknown>,
  millis: number,
  signal?: AbortSignal
) {
  let running = true

  function handleAbort() {
    running = false
  }

  signal?.addEventListener('abort', handleAbort)

  async function run() {
    try {
      while (running) {
        await func()
        await sleep(millis, signal)
      }
    } finally {
      signal?.removeEventListener('abort', handleAbort)
    }
  }

  return run()
}
