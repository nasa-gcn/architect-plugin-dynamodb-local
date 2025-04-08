import { sleep } from '@nasa-gcn/architect-plugin-utils'
import { ExecaError, execa } from 'execa'
import assert from 'node:assert'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

describe('dynamodb-local stops on Ctrl-C', () => {
  let process: ReturnType<typeof execa> | undefined

  beforeEach(async () => {
    // FIXME: replace with import.meta.resolve once it is stable in Node.js
    const cwd = join(dirname(fileURLToPath(import.meta.url)), 'project')

    process = execa('arc', ['sandbox'], {
      cwd,
      preferLocal: true,
      forceKillAfterDelay: false,
      stdin: 'pipe',
      stderr: 'inherit',
      stdout: ['inherit', 'pipe'],
    })

    return new Promise<void>((resolve) => {
      process?.stdout?.on('data', (chunk) => {
        if (chunk.includes('Ran Sandbox startup plugin in')) resolve()
      })
    })
  })

  afterEach(async () => {
    if (process) {
      // Type Ctrl-C into Architect's stdin
      process.stdin?.write('\u0003')
      // Make sure arc sandbox is dead
      try {
        await process
      } catch (e) {
        if (!(e instanceof ExecaError)) throw e
      }
      // Give subprocesses some time to die
      await sleep(1000)

      // Make sure that arc sandbox and opensearch/elasticseasrch are both
      // down and not responding to HTTP requests any more
      for (const port of [8000]) {
        await assert.rejects(
          fetch(`http://localhost:${port}/`),
          TypeError,
          `port ${port} must be closed`
        )
      }
    }
  })

  test('connection was alive', async () => {
    let response, json

    response = await fetch('http://localhost:3333/carts/the-doctor')
    assert(response.ok)
    json = (await response.json()) as { cartTotal: number }
    assert.strictEqual(json.cartTotal, 50)

    // 50% off sale on sonic screwdrivers!
    response = await fetch('http://localhost:3333/products/sonic-screwdriver', {
      method: 'PUT',
      body: JSON.stringify({
        productName: 'sonic-screwdriver',
        productUnitPrice: 5,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    assert(response.ok)

    // Wait for tables-streams Lambda to run
    await sleep(2000)

    response = await fetch('http://localhost:3333/carts/the-doctor')
    assert(response.ok)
    json = (await response.json()) as { cartTotal: number }
    assert.strictEqual(json.cartTotal, 40)
  })
})
