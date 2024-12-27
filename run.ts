/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path'
import waitPort from 'wait-port'
import { mkdtemp } from 'node:fs/promises'
import { mkdirP, temp } from './paths.js'
import rimraf from 'rimraf'
import { UnexpectedResolveError } from './promises.js'
import { launchDocker, removeContainer } from './runDocker.js'
import { execSync } from 'node:child_process'

export type LauncherFunction<T = object> = (
  props: T & {
    options: string[]
    dataDir: string
    logsDir: string
    port: number
  }
) => Promise<{
  kill: () => Promise<string>
  waitUntilStopped: () => Promise<void>
}>

export async function launch() {
  const port = 8000
  const url = `http://localhost:${port}`

  const options = [`http.port=${port}`, 'discovery.type=single-node']

  console.log('Making Dir: ', temp)
  await mkdirP(temp)
  const tempDir = await mkdtemp(join(temp, 'run-'))
  const [dataDir, logsDir] = ['data', 'logs'].map((s) => join(tempDir, s))
  await Promise.all([dataDir, logsDir].map(mkdirP))

  const props = { dataDir, logsDir, options, port }
  console.log('Launching Docker...')
  const { kill, waitUntilStopped } = await launchDocker(props)
  console.log('Launched: ')
  try {
    await waitPort({ port })
    execSync('aws dynamodb list-tables --endpoint-url http://localhost:8000')
  } catch (e) {
    if (e instanceof UnexpectedResolveError) {
      throw new Error('Local DynamoDB instance terminated unexpectedly')
    } else {
      throw e
    }
  }

  return {
    url,
    port,
    async stop() {
      const containerId = await kill()
      await waitUntilStopped()
      console.log('Removing container: ', containerId)
      await removeContainer(containerId)
      console.log('Removing temporary directory')
      await rimraf(tempDir)
    },
  }
}
