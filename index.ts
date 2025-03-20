/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { launch } from './run.js'
import _arcFunctions from '@architect/functions'
//@ts-expect-error: no type definitions
import { updater } from '@architect/utils'
import { DescribeTableCommand,
  DynamoDBClient,
  UpdateTableCommand } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb'
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  GetRecordsCommand,
  GetShardIteratorCommand,
  TrimmedDataAccessException,
} from '@aws-sdk/client-dynamodb-streams'
import { sleep } from './promises.js'

let local: Awaited<ReturnType<typeof launch>>

type ShardItem = {
  ShardIterator: string
}

const shardMap: { [key: string]: ShardItem[] } = {}

export const credentials = {
  // Any credentials can be provided for local
  accessKeyId: 'localDb',
  secretAccessKey: 'randomAnyString',
}

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

    const dynamodbClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: inv.aws.region,
        endpoint: local.url,
        requestHandler: {
          requestTimeout: 10_000,
          httpsAgent: { maxSockets: 500 }, // Increased from default to allow for higher throughput
        },
        credentials,
      })
    )
    const seedFile = arc['architect-plugin-dynamodb-local']?.find(
      (item: string[]) => item[0] == 'seedFile'
    )[1]
    const client = await _arcFunctions.tables()
    if (seedFile) await seedDb(seedFile, dynamodbClient)

    const tableStreams = inv['tables-streams']
    const ddbStreamsClient = new DynamoDBStreamsClient({
      region: inv.aws.region,
      endpoint: `http://localhost:${getPort(inv)}`,
      credentials,
    })
    // Init table streams for those defined
    await Promise.all(
      // @ts-expect-error table has any type
      (tableStreams ?? []).map(({ table }) =>
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

    if (tableStreams) {
      // Reset Stream defaults
      for (const arcStream of tableStreams) {
        shardMap[arcStream.table] = []
        await resetTableStreams(
          dynamodbClient,
          ddbStreamsClient,
          arcStream.table
        )
      }

      // eslint-disable-next-line no-constant-condition
      while (true) {
        await sleep(2000)
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
                invoke({
                  pragma: 'tables-streams',
                  name: key,
                  payload: event,
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
              }

              await resetTableStreams(dynamodbClient, ddbStreamsClient, key)
            }
          }
        }
      }
    }
  },
  async end() {
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
              ShardIteratorType: 'LATEST',
              ShardId: shard.ShardId,
            })
          )
        ).ShardIterator

        if (ShardIterator) {
          shardMap[arcTableName].push({
            ShardIterator: ShardIterator,
          })
        }
      }
    }
  }
}
