/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import Dockerode, { Container } from 'dockerode'
import { fork } from 'node:child_process'
import { LauncherFunction } from './run.js'
import { promisify } from 'node:util'

const [, , command, jsonifiedArgs] = process.argv
const docker = new Dockerode({ protocol: 'http' })
const imageName = 'amazon/dynamodb-local:latest'

let containerId = ''
if (command === 'launch-ddb-local-docker-subprocess') {
  const { port } = JSON.parse(jsonifiedArgs)
  let container: Container
  try {
    container = await createDdbContainer(port)
  } catch (error) {
    console.error(error)
    // Fix for Windows, containers exit, but do not get removed properly.
    console.log('\nExisting container, removing and recreating')
    const containers = await docker.listContainers({
      limit: 1,
      filters: '{"name": ["dynamodb-local"]}',
    })
    for (const existing of containers) {
      if (existing.State !== 'exited') {
        await docker.getContainer(existing.Id).kill()
      }
      await docker.getContainer(existing.Id).remove()
    }
    container = await createDdbContainer(port)
  }
  containerId = container.id
  const stream = await container.attach({ stream: true, stderr: true })
  stream.pipe(process.stderr)
  await container.start()
  const signals = ['message', 'SIGTERM', 'SIGINT']
  signals.forEach((signal) => {
    process.on(signal, async () => {
      await container.kill()
      await container.remove()
    })
  })
}

export const launchDocker: LauncherFunction = async ({ port, options }) => {
  const argv = {
    port,
    options,
  }
  const subprocess = fork(new URL(import.meta.url), [
    'launch-ddb-local-docker-subprocess',
    JSON.stringify(argv),
  ])
  return {
    async kill() {
      console.log('Killing Docker container')
      subprocess.kill()
      return containerId
    },
    async waitUntilStopped() {
      return new Promise((resolve) => {
        subprocess.on('exit', () => {
          console.log('Docker container exited')
          resolve()
        })
      })
    },
  }
}

export async function removeContainer(containerId: string) {
  await docker.getContainer(containerId).remove()
}

async function pullImage(imageName: string) {
  console.log(`Checking for and pulling ${imageName}. This may take a moment`)
  await promisify(docker.modem.followProgress)(await docker.pull(imageName))
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
