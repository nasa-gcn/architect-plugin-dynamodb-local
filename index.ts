import { launch } from './run.js'

let local: Awaited<ReturnType<typeof launch>>

export const deploy = {
  async services() {
    local = await launch()
  },
}

export const sandbox = {
  async end() {
    await local.stop()
  },
}
