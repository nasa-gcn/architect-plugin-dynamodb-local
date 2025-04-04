/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { credentials } from '..'
import seedData from '../sandbox-seed.json'
import { TableStreamItem } from '../types'
import arc from '@architect/functions'
// @ts-expect-error @architect/inventory has no types
import inventory from '@architect/inventory'
import sandbox from '@architect/sandbox'
import { DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { sleep } from '@nasa-gcn/architect-plugin-utils'
import Dockerode from 'dockerode'
import assert from 'node:assert'
import { before, describe, it } from 'node:test'

const docker = new Dockerode()
const seed = seedData as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

describe('Startup tests', () => {
  // Setup
  before(async () => {
    await sandbox.start()
  })

  it('one container should be present after startup', async () => {
    const containers = await docker.listContainers({
      limit: 1,
      filters: '{"name": ["dynamodb-local"]}',
    })
    assert.equal(containers.length, 1)
  })

  it('tables should be present and seeded from the seed file', async () => {
    const tables = await arc.tables()

    for (const table of Object.keys(seed)) {
      const tableItems = await tables[table].scanAll({})
      assert.equal(tableItems.length, seed[table].length)
    }
  })

  it('streams should be enabled on tables defined in @tables-streams pragma', async () => {
    const { inv } = await inventory()
    const tables = await arc.tables()

    const tableStreams = inv['tables-streams'].map(
      (stream: TableStreamItem) => stream.table
    )
    const ddbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: inv.aws.region,
        endpoint: 'http://0.0.0.0:8000',
        requestHandler: {
          requestTimeout: 10_000,
          httpsAgent: { maxSockets: 500 }, // Increased from default to allow for higher throughput
        },
        credentials,
      })
    )

    for (const tableName of tableStreams) {
      const { Table } = await ddbClient.send(
        new DescribeTableCommand({
          TableName: tables.name(tableName),
        })
      )
      // StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' }
      console.log(Table?.StreamSpecification)
    }
  })

  it('should stream', async () => {
    // Sleep timers added to compensate for offset in polling interval)
    // May be worth it to review how the invoke function passes records, as multiple may be passed at a time
    await sleep(2000)
    const tables = await arc.tables()
    await tables.testTable.put({ itemID: 5, name: 'fifth' })
    await sleep(2000)
    await tables.testTable.put({ itemID: 6, name: 'sixth' })
    await sleep(2000)
  })
})

describe('Teardown tests', () => {
  it('container should be removed', async () => {
    await sandbox.end()
    const containers = await docker.listContainers({
      limit: 1,
      filters: '{"name": ["dynamodb-local"]}',
    })
    assert.equal(containers.length, 0)
  })
})
