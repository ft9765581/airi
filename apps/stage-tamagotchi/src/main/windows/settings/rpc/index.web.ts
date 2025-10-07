import type { BrowserWindow } from 'electron'

import { defineInvoke } from '@unbird/eventa'
import { createContext } from '@unbird/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronOpenSettings } from '../../../../shared/eventa'

let webInvokes: {
  openSettings: () => Promise<void>
}

export function setupWebInvokes(window: BrowserWindow) {
  const eventaContext = createContext(ipcMain, window)
  const { context } = eventaContext

  webInvokes = {
    openSettings: defineInvoke(context, electronOpenSettings),
  }
}

export function useWebInvokes() {
  if (!webInvokes) {
    throw new Error('App client is not initialized')
  }

  return webInvokes
}
