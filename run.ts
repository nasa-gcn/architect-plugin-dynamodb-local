/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import waitPort from 'wait-port'
import { UnexpectedResolveError } from './promises.js'
import { launchDocker, removeContainer } from './runDocker.js'
import { execSync } from 'node:child_process'

export type LauncherFunction<T = object> = (
  props: T & {
    options: string[]
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

  const props = {
    options,
    port,
  }
  console.log('Launching Docker...')
  const { kill, waitUntilStopped } = await launchDocker(props)
  console.log('Launched: ')
  try {
    await waitPort({ port })
    let dynamodbReady = false
    while (!dynamodbReady) {
      try {
        execSync(
          'aws dynamodb list-tables --endpoint-url http://localhost:8000'
        )
        dynamodbReady = true
      } catch (e) {
        console.log('table connection not ready, trying again')
      }
    }
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
    },
  }
}
