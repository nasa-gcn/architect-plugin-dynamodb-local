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

const [, , command, jsonifiedArgs] = process.argv
const docker = new Dockerode({ protocol: 'http' })

let containerId = ''

if (command === 'launch-ddb-local-docker-subprocess') {
  const { dataDir, logsDir, port, options } = JSON.parse(jsonifiedArgs)

  const container = await docker.createContainer({
    Image: 'amazon/dynamodb-local:latest',
    name: 'dynamodb-local',
    Tty: true,
    Cmd: [
      '-jar',
      'DynamoDBLocal.jar',
      '-sharedDb',
      '-dbPath',
      '/home/dynamodblocal/data',
    ],
    WorkingDir: '/home/dynamodblocal',
    ExposedPorts: {
      '8000/tcp': {},
    },
    Env: [
      ...options,
      'path.data=/var/lib/ddb-local',
      'path.logs=/var/log/ddb-local',
    ],
    HostConfig: {
      Binds: [`${dataDir}:/home/dynamodblocal/data`],
      PortBindings: {
        [`${port}/tcp`]: [{ HostIp: '0.0.0.0', HostPort: `${port}` }],
      },
    },
  })
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

export const launchDocker: LauncherFunction = async ({
  dataDir,
  logsDir,
  port,
  options,
}) => {
  const argv = {
    dataDir,
    logsDir,
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
