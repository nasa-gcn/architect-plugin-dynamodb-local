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
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { credentials } from './index'

export type LauncherFunction<T = object> = (
  props: T & {
    port: number
  }
) => Promise<{
  kill: () => Promise<string>
  waitUntilStopped: () => Promise<void>
}>

export async function launch(port: number) {
  const url = `http://localhost:${port}`

  const props = {
    port,
  }
  console.log('Launching Docker...')
  const { kill, waitUntilStopped } = await launchDocker(props)
  console.log('Launched: ')
  try {
    await waitPort({ port })
    let dynamodbReady = false
    const ddbClient = new DynamoDBClient({
      endpoint: url,
      credentials,
    })
    while (!dynamodbReady) {
      try {
        const ddbPing = await ddbClient.send(new ListTablesCommand({}))
        if (ddbPing.TableNames) dynamodbReady = true
      } catch (e) {
        console.log(e, ', table connection not ready, trying again')
        await new Promise((f) => setTimeout(f, 1000))
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
