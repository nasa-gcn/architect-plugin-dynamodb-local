/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { credentials } from './index'
import { launchDocker, removeContainer } from './runDocker.js'
import { updater } from '@architect/utils'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { sleep, UnexpectedResolveError } from '@nasa-gcn/architect-plugin-utils'
import Dockerode from 'dockerode'
import waitPort from 'wait-port'

export async function launch(port: number) {
  const update = updater('DynamoDB Local')
  const url = `http://0.0.0.0:${port}`
  const props = {
    port,
  }
  update.start('Launching Docker container')
  const { kill } = await launchDocker(props)
  update.status(`Waiting for connection on port ${port}`)
  try {
    await waitPort({ port })
    let dynamodbReady = false
    const ddbClient = new DynamoDBClient({
      endpoint: url,
      credentials,
    })
    update.status(`Waiting for DynamoDB to be up`)
    while (!dynamodbReady) {
      try {
        update.status('Connecting...')
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
      console.error(e)
    }
  }

  update.done('DynamoDB is up!')

  return {
    url,
    port,
    async stop() {
      const containerId = await kill()
      await waitUntilStopped(containerId)
      await removeContainer(containerId)
    },
  }
}

async function waitUntilStopped(containerId: string) {
  let stopped = false
  const docker = new Dockerode()
  while (!stopped) {
    stopped =
      (await docker.getContainer(containerId).inspect()).State.Status ===
      'exited'
  }
  return new Promise<void>((resolve) => {
    resolve()
  })
}
