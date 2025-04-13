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
  type DynamoDBClient,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb'
import {
  DescribeStreamCommand,
  DynamoDBStreamsClient,
  ExpiredIteratorException,
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
import invariant from 'tiny-invariant'
import { dedent } from 'ts-dedent'

let local: Awaited<ReturnType<typeof launch>>

let dynamoDbStreamsLoop: Promise<void>
let abortController: AbortController

function defined<T>(value: T) {
  invariant(value)
  return value
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

function isSandbox() {
  return process.argv.includes('sandbox')
}

export const deploy = {
  // @ts-expect-error: The Architect plugins API has no type definitions.
  async services({ inventory: { inv } }) {
    if (isSandbox() && isEnabled(inv)) local = await launch(getPort(inv))
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

    const seedFile = arc['dynamodb-local']?.find(
      (item: string[]) => item[0] == 'seedFile'
    )[1]
    if (seedFile)
      await seedDb(seedFile, DynamoDBDocumentClient.from(local.client))

    abortController = new AbortController()

    const tableStreamsConfig: TableStreamItem[] | undefined =
      inv['tables-streams']
    if (tableStreamsConfig?.length) {
      const arc_tables = await _arcFunctions.tables()
      const ddbStreamsClient = new DynamoDBStreamsClient({
        region: inv.aws.region,
        endpoint: local.client.config.endpoint,
        credentials: local.client.config.credentials,
      })

      const streamIterators = Object.entries(
        Object.groupBy(tableStreamsConfig, ({ table }) => table)
      ).map(async function* ([table, configs]) {
        const { TableDescription } = await local.client.send(
          new UpdateTableCommand({
            TableName: arc_tables.name(table),
            StreamSpecification: {
              StreamEnabled: true,
              StreamViewType: 'NEW_AND_OLD_IMAGES',
            },
          })
        )
        const StreamArn = TableDescription?.LatestStreamArn
        while (!abortController.signal.aborted) {
          const { StreamDescription } = await ddbStreamsClient.send(
            new DescribeStreamCommand({ StreamArn })
          )
          try {
            for (const { ShardId } of defined(StreamDescription?.Shards)) {
              let { ShardIterator } = await ddbStreamsClient.send(
                new GetShardIteratorCommand({
                  ShardId,
                  StreamArn,
                  ShardIteratorType: 'TRIM_HORIZON',
                })
              )
              while (ShardIterator) {
                const { NextShardIterator, ...payload } =
                  await ddbStreamsClient.send(
                    new GetRecordsCommand({ ShardIterator })
                  )
                if (payload.Records?.length) {
                  for (const { name, pragma } of defined(configs)) {
                    try {
                      await invoke({
                        name,
                        pragma,
                        payload,
                      })
                    } catch (e) {
                      console.error(e)
                    }
                  }
                }
                ShardIterator = NextShardIterator
                yield
              }
            }
          } catch (e) {
            if (
              !(
                e instanceof TrimmedDataAccessException ||
                e instanceof ExpiredIteratorException
              )
            ) {
              throw e
            }
          }
        }
      })

      dynamoDbStreamsLoop = periodically(
        () => Promise.all(streamIterators.map((gen) => gen.next())),
        1000,
        abortController.signal
      )
    }
  },
  async end() {
    abortController.abort()
    await dynamoDbStreamsLoop
    await local.stop()
  },
}

// Versions of @architect/sandbox did not not define credentials for DynamoDB
// in sandbox mode.
export const set = {
  env() {
    if (isSandbox())
      return { AWS_ACCESS_KEY_ID: 'dummy', AWS_SECRET_ACCESS_KEY: 'dummy' }
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
