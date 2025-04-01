/*!
 * Copyright © 2023 United States Government as represented by the
 * Administrator of the National Aeronautics and Space Administration.
 * All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Provides a type for the data structure coming from the Architect Inventory
export type TableStreamItem = {
  name: string
  table: string
  config: TableStreamConfig
  src: string
  handlerFile: string
  handlerMethod: string
  handlerModuleSystem: string
  configFile: string
  pragma: string
}

type TableStreamConfig = {
  timeout: number
  memory: number
  runtime: string
  architecture: string
  handler: string
  state: string
  concurrency: number
  storage: number
  layers: []
  policies: []
  shared: boolean
  env: boolean
  region: string
  hydrate: boolean
}
