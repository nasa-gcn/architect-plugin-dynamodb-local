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

// [
//   {
//     name: 'circulars',
//     table: 'circulars',
//     config: {
//       timeout: 30,
//       memory: 256,
//       runtime: 'nodejs22.x',
//       architecture: 'arm64',
//       handler: 'index.handler',
//       state: 'n/a',
//       concurrency: 1,
//       storage: 512,
//       layers: [],
//       policies: [],
//       shared: true,
//       env: true,
//       region: 'us-east-1',
//       hydrate: false
//     },
//     src: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\circulars',
//     handlerFile: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\circulars\\index.cjs',
//     handlerMethod: 'handler',
//     handlerModuleSystem: 'cjs',
//     configFile: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\circulars\\config.arc',
//     pragma: 'tables-streams'
//   },
//   {
//     name: 'pocSecondStreamExample',
//     table: 'circulars',
//     config: {
//       timeout: 30,
//       memory: 256,
//       runtime: 'nodejs22.x',
//       architecture: 'arm64',
//       handler: 'index.handler',
//       state: 'n/a',
//       concurrency: 'unthrottled',
//       storage: 512,
//       layers: [],
//       policies: [],
//       shared: true,
//       env: true,
//       region: 'us-east-1',
//       hydrate: false
//     },
//     src: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\demo',
//     handlerFile: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\demo\\index.cjs',
//     handlerMethod: 'handler',
//     handlerModuleSystem: 'cjs',
//     configFile: null,
//     pragma: 'tables-streams'
//   },
//   {
//     name: 'synonyms',
//     table: 'synonyms',
//     config: {
//       timeout: 30,
//       memory: 256,
//       runtime: 'nodejs22.x',
//       architecture: 'arm64',
//       handler: 'index.handler',
//       state: 'n/a',
//       concurrency: 1,
//       storage: 512,
//       layers: [],
//       policies: [],
//       shared: true,
//       env: true,
//       region: 'us-east-1',
//       hydrate: false
//     },
//     src: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\synonyms',
//     handlerFile: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\synonyms\\index.cjs',
//     handlerMethod: 'handler',
//     handlerModuleSystem: 'cjs',
//     configFile: 'C:\\Repos\\gcn.nasa.gov\\build\\table-streams\\synonyms\\config.arc',
//     pragma: 'tables-streams'
//   }
// ]
