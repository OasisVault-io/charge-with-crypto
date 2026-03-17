import { createAppContext, startAppContext } from './appContext'
import { config } from './config'

let appContext: any = null

export function getAppContext() {
  if (!appContext) {
    appContext = createAppContext(config)
    startAppContext(appContext)
  }
  return appContext
}

export function getConfig() {
  return config
}
