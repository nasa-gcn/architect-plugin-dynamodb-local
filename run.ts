/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { credentials } from './index'
import { updater } from '@architect/utils'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { launchDockerSubprocess, sleep } from '@nasa-gcn/architect-plugin-utils'

async function waitForConnection(client: DynamoDBClient) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { TableNames } = await client.send(new ListTablesCommand({}))
      if (TableNames) return
    } catch {
      /* empty */
    }
    await sleep(1000)
  }
}

export async function launch(port: number) {
  const update = updater('DynamoDB Local')
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
  const untilStopped = waitUntilStopped()
  const client = new DynamoDBClient({
    endpoint: `http://0.0.0.0:${port}`,
    credentials,
  })
  update.update(`Waiting for DynamoDB to be up`)
  try {
    await Promise.race([untilStopped, waitForConnection(client)])
  } catch (e) {
    update.err('Search engine terminated unexpectedly')
    throw e
  }
  update.done('DynamoDB is up!')

  return {
    client,
    async stop() {
      await kill()
      await untilStopped
    },
  }
}
