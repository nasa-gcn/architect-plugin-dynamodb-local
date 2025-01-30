import { launch } from './run.js'
import {
  BatchWriteItemCommand,
  BatchWriteItemCommandOutput,
  DynamoDBClient,
  UpdateTableCommand,
  WriteRequest,
} from '@aws-sdk/client-dynamodb'
import _arcFunctions from '@architect/functions'
import { marshall } from '@aws-sdk/util-dynamodb'
import { access, constants, readFile } from 'node:fs/promises'
import dedent from 'dedent'
import chunk from 'lodash.chunk'

let local: Awaited<ReturnType<typeof launch>>

export const deploy = {
  async services() {
    if (process.env.ARC_DB_EXTERNAL) local = await launch()
  },
}

export const sandbox = {
  // @ts-expect-error: The Architect plugins API has no type definitions.
  async start({ inventory: { inv }, arc }) {
    const dynamodbClient = new DynamoDBClient({
      region: inv.aws.region,
      endpoint: `http://localhost:${process.env.ARC_TABLES_PORT}`,
      requestHandler: {
        requestTimeout: 3_000,
        httpsAgent: { maxSockets: 500 }, // Increased from default to allow for higher throughput
      },
    })
    const seedFile = arc['architect-plugin-dynamodb-local'].find(
      (item: string[]) => item[0] == 'seedFile'
    )[1]
    const client = await _arcFunctions.tables()
    if (seedFile) {
      if (['sandbox-seed.json', 'sandbox-seed.js'].includes(seedFile)) {
        console.log(dedent`
          The provided seed file matches Architect's default seed pattern.
          Architect's seed function will be used. This may result in many 
          triggers of your streams functions.
          If you wish to use the seeding function build into this package, 
          please rename your file to something other than 'sandbox-seed.json' 
          or 'sandbox-seed.js'.
          `)
      } else {
        await seedDb(seedFile, dynamodbClient)
      }
    }

    for (const tableStream of inv['tables-streams']) {
      const generatedDynamoTableName = client.name(tableStream.table)
      await dynamodbClient.send(
        new UpdateTableCommand({
          TableName: generatedDynamoTableName,
          StreamSpecification: {
            StreamEnabled: true,
            StreamViewType: 'NEW_AND_OLD_IMAGES',
          },
        })
      )
    }
  },
  async end() {
    await local.stop()
  },
}

async function seedDb(seedFile: string, dynamoDB: DynamoDBClient) {
  try {
    try {
      await access(seedFile, constants.R_OK)
    } catch {
      console.log(`File "${seedFile}" not found in the current directory.`)
      return
    }
    const data = JSON.parse(await readFile(seedFile, 'utf8'))
    const client = await _arcFunctions.tables()

    const batches: Promise<BatchWriteItemCommandOutput>[] = []
    Object.entries(data).forEach(([tableName, items]) => {
      const formattedName = client.name(tableName)

      // @ts-expect-error `Items` is an array of any table items
      const chunks = chunk(items, 25)

      for (const chunk of chunks) {
        const RequestItems: Record<string, WriteRequest[]> = {}
        RequestItems[formattedName] = chunk.map((item) => {
          return {
            PutRequest: {
              Item: marshall(item),
            },
          }
        })

        console.log('Seeding: ', formattedName)

        batches.push(dynamoDB.send(new BatchWriteItemCommand({ RequestItems })))
      }
    })
    await Promise.all(batches)

    console.log(`DynamoDB local tables seeded from ${seedFile}`)
  } catch (error) {
    console.error('Error seeding data:', error)
  }
}
