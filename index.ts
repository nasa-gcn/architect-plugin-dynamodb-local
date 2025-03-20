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
import { DynamoDBClient, UpdateTableCommand } from '@aws-sdk/client-dynamodb'
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb'
import { NativeAttributeValue } from '@aws-sdk/util-dynamodb'
import chunk from 'lodash/chunk.js'
import { access, constants, readFile } from 'node:fs/promises'
import { dedent } from 'ts-dedent'

let local: Awaited<ReturnType<typeof launch>>

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
  async start({ inventory: { inv }, arc }) {
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

    await Promise.all(
      // @ts-expect-error table has any type
      (inv['tables-streams'] ?? []).map(({ table }) =>
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
