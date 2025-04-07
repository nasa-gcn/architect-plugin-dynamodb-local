/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { credentials } from './index'
//@ts-expect-error: no type definitions
import { updater } from '@architect/utils'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import {
  launchDockerSubprocess,
  sleep,
  UnexpectedResolveError,
} from '@nasa-gcn/architect-plugin-utils'
import waitPort from 'wait-port'

export async function launch(port: number) {
  const update = updater('DynamoDB Local')
  const url = `http://0.0.0.0:${port}`
  const { kill, waitUntilStopped } = await launchDockerSubprocess({
    Image: 'amazon/dynamodb-local',
    Cmd: ['-jar', 'DynamoDBLocal.jar', '-sharedDb', '-dbPath', '/tmp/'],
    ExposedPorts: {
      '8000/tcp': {},
    },
    HostConfig: {
      PortBindings: {
        [`${port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: `${port}` }],
      },
    },
  })
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
    async stop() {
      await kill()
      await waitUntilStopped()
    },
  }
}
