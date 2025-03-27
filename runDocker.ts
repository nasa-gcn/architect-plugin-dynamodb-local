/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import Dockerode, { Container } from 'dockerode'

const imageName = 'amazon/dynamodb-local:latest'

export type HttpError = {
  reason: string | undefined
  statusCode: number
  json: object
}

type LauncherFunction<T = object> = (
  props: T & {
    port: number
  }
) => Promise<{
  kill: () => Promise<string>
  containerId: string
}>

let containerId = ''
const docker = new Dockerode({ protocol: 'http' })

export const launchDocker: LauncherFunction = async ({ port }) => {
  let container: Container
  try {
    container = await createDdbContainer(port)
  } catch (error) {
    if ((error as HttpError).statusCode == 409) {
      console.log('\nExisting container, removing and recreating')
    } else {
      console.log(error)
    }
    const containers = await docker.listContainers({
      limit: 1,
      filters: '{"name": ["dynamodb-local"]}',
    })
    for (const existing of containers) {
      if (existing.State === 'running') {
        await docker.getContainer(existing.Id).kill()
      }
      await docker.getContainer(existing.Id).remove()
    }
    container = await createDdbContainer(port)
  }
  containerId = container.id
  let containerReady = false
  while (!containerReady) {
    containerReady = (await container.inspect()).State.Status === 'created'
  }
  await container.start()
  const signals = ['message', 'SIGTERM', 'SIGINT']
  signals.forEach((signal) => {
    process.on(signal, async () => {
      await container.kill()
      await container.remove()
    })
  })

  return {
    async kill() {
      await docker.getContainer(containerId).stop()
      return containerId
    },
    containerId,
  }
}

export async function removeContainer(containerId: string) {
  const container = docker.getContainer(containerId)
  await container.remove()
}

async function pullImage(imageName: string) {
  console.log(`Checking for and pulling ${imageName}. This may take a moment`)

  try {
    const stream = await docker.pull(imageName)
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err, res) =>
        err ? reject(err) : resolve(res)
      )
    })
  } catch (e) {
    console.log(e)
  }

  console.log('Done')
}

async function createDdbContainer(port: number) {
  await pullImage(imageName)

  return await docker.createContainer({
    Image: imageName,
    name: 'dynamodb-local',
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
}
