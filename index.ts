import { launch } from './run.js'
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandOutput,
  UpdateTableCommand,
} from '@aws-sdk/client-dynamodb'
import _arcFunctions from '@architect/functions'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { marshall } from '@aws-sdk/util-dynamodb'

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
        console.log(
          "The seed file has not been renamed. Architect's default seed function will be used. This may result in many triggers of your streams functions."
        )
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
    const filePath = searchFileInCurrentDirectory(seedFile)

    if (!filePath) {
      console.log('File not found')
      return
    }
    const data = JSON.parse(readFileSync(filePath, 'utf8'))
    const client = await _arcFunctions.tables()

    const putItemPromises: Promise<PutItemCommandOutput>[] = []
    for (const TableName of Object.keys(data)) {
      // @ts-expect-error `Item` can be any table item
      data[TableName].map((Item) => {
        putItemPromises.push(
          dynamoDB.send(
            new PutItemCommand({
              TableName: client.name(TableName),
              Item: marshall(Item),
            })
          )
        )
      })
      console.log(`Seeding ${TableName} with ${data[TableName].length} items`)
    }
    await Promise.all(putItemPromises)
    console.log(`DynamoDB local tables seeded from ${seedFile}`)
  } catch (error) {
    console.error('Error seeding data:', error)
  }
}

function searchFileInCurrentDirectory(fileName: string): string | null {
  const currentDir = process.cwd() // Current working directory
  const files = readdirSync(currentDir) // Read the contents of the current directory

  // Check if the file exists in the directory
  const foundFile = files.find((file) => file === fileName)

  if (foundFile) {
    return path.resolve(currentDir, foundFile) // Return the full path
  } else {
    console.log(`File "${fileName}" not found in the current directory.`)
    return null
  }
}
