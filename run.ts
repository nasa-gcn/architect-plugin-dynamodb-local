/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { credentials } from './index'
import { sleep, UnexpectedResolveError } from './promises.js'
import { launchDocker, removeContainer } from './runDocker.js'
//@ts-expect-error: no type definitions
import { updater } from '@architect/utils'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import waitPort from 'wait-port'

export type LauncherFunction<T = object> = (
  props: T & {
    port: number
  }
) => Promise<{
  kill: () => Promise<string>
  waitUntilStopped: () => Promise<void>
}>

export async function launch(port: number) {
  const update = updater('DynamoDB Local')
  const url = `http://localhost:${port}`

  const props = {
    port,
  }
  update.start('Launching Docker container')
  const { kill, waitUntilStopped } = await launchDocker(props)
  update.status(`Waiting for connection on port ${port}`)
  try {
    await waitPort({ port, output: 'silent' })
    let dynamodbReady = false
    const ddbClient = new DynamoDBClient({
      endpoint: url,
      credentials,
    })
    update.status(`Waiting for DynamoDB to be up`)
    while (!dynamodbReady) {
      try {
        const ddbPing = await ddbClient.send(new ListTablesCommand({}))
        if (ddbPing.TableNames) dynamodbReady = true
      } catch (e) {
        update.status(e, ', table connection not ready, trying again')
        await sleep(1000)
      }
    }
  } catch (e) {
    if (e instanceof UnexpectedResolveError) {
      throw new Error('Local DynamoDB instance terminated unexpectedly')
    } else {
      throw e
    }
  }
  update.done('DynamoDB is up!')

  return {
    url,
    port,
    async stop() {
      const containerId = await kill()
      await waitUntilStopped()
      console.log('Removing container: ', containerId)
      await removeContainer(containerId)
    },
  }
}
