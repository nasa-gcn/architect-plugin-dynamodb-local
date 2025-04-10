/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { launch } from './run.js'
import { TableStreamItem } from './types.js'
import _arcFunctions from '@architect/functions'
import { updater } from '@architect/utils'
import {
  DescribeTableCommand,
  type DynamoDBClient,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb'
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
  TrimmedDataAccessException,
} from '@aws-sdk/client-dynamodb-streams'
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb'
import { NativeAttributeValue } from '@aws-sdk/util-dynamodb'
import { periodically } from '@nasa-gcn/architect-plugin-utils'
import chunk from 'lodash/chunk.js'
import { access, constants, readFile } from 'node:fs/promises'
import { dedent } from 'ts-dedent'

let local: Awaited<ReturnType<typeof launch>>

type ShardItem = {
  ShardIterator: string
}

let dynamoDbStreamsLoop: Promise<void>
let abortController: AbortController

const shardMap: { [key: string]: ShardItem[] } = {}

// @ts-expect-error: The Architect plugins API has no type definitions.
function isEnabled(inv) {
  return Boolean(
    inv._project.preferences?.sandbox?.['external-db'] ||
      process.env.ARC_DB_EXTERNAL
  )
}

// @ts-expect-error: The Architect plugins API has no type definitions.
function getPort(inv) {
  return (
    inv._project.preferences?.sandbox?.ports?.tables ||
    Number(process.env.ARC_TABLES_PORT)
  )
}

export const deploy = {
  // @ts-expect-error: The Architect plugins API has no type definitions.
  async services({ inventory: { inv } }) {
    if (isEnabled(inv)) local = await launch(getPort(inv))
  },
}

export const sandbox = {
  // @ts-expect-error: The Architect plugins API has no type definitions.
  async start({ inventory: { inv }, arc, invoke }) {
    if (!isEnabled(inv)) {
      console.log(
        'ARC_DB_EXTERNAL is not set. To use the architect-plugin-dynamodb-local plugin, set this value to true in your .env file. Local dynamodb will use the sandbox setting'
      )
      return
    }

    const dynamodbClient = DynamoDBDocumentClient.from(local.client)
    const seedFile = arc['dynamodb-local']?.find(
      (item: string[]) => item[0] == 'seedFile'
    )[1]
    const client = await _arcFunctions.tables()
    if (seedFile) await seedDb(seedFile, dynamodbClient)
    const tableStreams: TableStreamItem[] = inv['tables-streams']
    abortController = new AbortController()
    if (tableStreams?.length) {
      const ddbStreamsClient = new DynamoDBStreamsClient({
        region: inv.aws.region,
        endpoint: local.client.config.endpoint,
        credentials: local.client.config.credentials,
      })
      // Init table streams for those defined
      await Promise.all(
        tableStreams
          .map(({ table }) => table)
          .filter(
            (item: string, index: number, tableNames: string[]) =>
              tableNames.indexOf(item) === index
          )
          .map((table: string) =>
            dynamodbClient.send(
              new UpdateTableCommand({
                TableName: client.name(table),
                StreamSpecification: {
                  StreamEnabled: true,
                  StreamViewType: 'NEW_AND_OLD_IMAGES',
                },
              })
            )
          )
      )
      // Reset Stream defaults
      for (const arcStream of tableStreams) {
        shardMap[arcStream.table] = []
        await resetTableStreams(
          dynamodbClient,
          ddbStreamsClient,
          arcStream.table
        )
      }

      dynamoDbStreamsLoop = periodically(
        () => streamLoop(ddbStreamsClient),
        2000,
        abortController.signal
      )
    }

    async function streamLoop(ddbStreamsClient: DynamoDBStreamsClient) {
      for (const key of Object.keys(shardMap)) {
        if (shardMap[key].length) {
          const shardItem = shardMap[key].pop()
          if (!shardItem) continue
          try {
            const event = await ddbStreamsClient.send(
              new GetRecordsCommand({
                ShardIterator: shardItem.ShardIterator,
              })
            )
            if (event.Records?.length) {
              tableStreams
                .filter((x) => x.table === key)
                .forEach((x) => {
                  invoke({
                    pragma: 'tables-streams',
                    name: x.name,
                    payload: event,
                  })
                })
            }

            if (event.NextShardIterator) {
              shardMap[key].push({
                ShardIterator: event.NextShardIterator,
              })
            }
          } catch (error) {
            if (error instanceof TrimmedDataAccessException) {
              console.log(error.name)
              await resetTableStreams(dynamodbClient, ddbStreamsClient, key)
            } else {
              throw error
            }
          }
        }
      }
    }
  },
  async end() {
    abortController.abort()
    await dynamoDbStreamsLoop
    await local.stop()
  },
}

async function seedDb(seedFile: string, dynamoDB: DynamoDBClient) {
  const update = updater('DynamoDB Seed')
  update.start(`Initializing database from "${seedFile}"`)
  if (['sandbox-seed.json', 'sandbox-seed.js'].includes(seedFile)) {
    update.err(dedent`
      The provided seed file matches Architect's default seed pattern.
      Architect's seed function will be used. This may result in many 
      triggers of your streams functions.
      If you wish to use the seeding function build into this package, 
      please rename your file to something other than 'sandbox-seed.json' 
      or 'sandbox-seed.js'.
      `)
    return
  }
  try {
    await access(seedFile, constants.R_OK)
  } catch {
    update.err(`File "${seedFile}" found or not readable`)
    return
  }

  try {
    const data: Record<
      string,
      Array<Record<string, NativeAttributeValue>>
    > = JSON.parse(await readFile(seedFile, 'utf8'))
    const client = await _arcFunctions.tables()

    await Promise.all(
      Object.entries(data).flatMap(([tableName, items]) => {
        const formattedName = client.name(tableName)
        return chunk(items, 25).map((chunk) =>
          dynamoDB.send(
            new BatchWriteCommand({
              RequestItems: {
                [formattedName]: chunk.map((Item) => ({
                  PutRequest: {
                    Item,
                  },
                })),
              },
            })
          )
        )
      })
    )

    update.done(`Initialized database from "${seedFile}"`)
  } catch (error) {
    update.err(error)
  }
}

async function resetTableStreams(
  ddbClient: DynamoDBClient,
  ddbStreamsClient: DynamoDBStreamsClient,
  arcTableName: string
) {
  const db = await _arcFunctions.tables()
  const tableName = db.name(arcTableName)
  const table = await ddbClient.send(
    new DescribeTableCommand({
      TableName: tableName,
    })
  )
  const stream = await ddbStreamsClient.send(
    new DescribeStreamCommand({
      StreamArn: table.Table?.LatestStreamArn,
    })
  )
  const shardArray = stream.StreamDescription?.Shards
  if (shardArray && table.Table?.LatestStreamArn) {
    for (const shard of shardArray) {
      if (shard.ShardId) {
        const ShardIterator = (
          await ddbStreamsClient.send(
            new GetShardIteratorCommand({
              StreamArn: table.Table.LatestStreamArn,
              ShardIteratorType: 'TRIM_HORIZON',
              ShardId: shard.ShardId,
            })
          )
        ).ShardIterator

        if (ShardIterator) {
          shardMap[arcTableName] = [{ ShardIterator }]
        }
      }
    }
  }
}
