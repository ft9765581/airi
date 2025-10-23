import { defineInvoke } from '@unbird/eventa'
import { useAsyncState, useIntervalFn, useWindowSize } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { electron } from '../../shared/eventa'
import { useElectronRelativeMouse } from '../composables/electron-vueuse'
import { useElectronEventaContext } from '../composables/electron-vueuse/use-electron-eventa-context'
import { useWindowControlStore } from './window-controls'

export function useElectronAllDisplays() {
  const context = useElectronEventaContext()
  const getAllDisplays = defineInvoke(context.value, electron.screen.getAllDisplays)
  const { state: allDisplays, execute } = useAsyncState(() => getAllDisplays(), [])

  useIntervalFn(() => {
    execute()
  }, 5000)

  return allDisplays
}

export const useWindowStore = defineStore('tamagotchi-window', () => {
  const windowControlStore = useWindowControlStore()

  const { width, height } = useWindowSize()
  const centerPos = computed(() => ({ x: width.value / 2, y: height.value / 2 }))

  // Use window-relative mouse coordinates for Live2D focus
  // Transforms screen coordinates to window-relative coordinates
  const { x: live2dLookAtX, y: live2dLookAtY } = useElectronRelativeMouse({ initialValue: centerPos.value })

  const isCursorInside = ref(false)
  const shouldHideView = computed(() => isCursorInside.value && !windowControlStore.isControlActive && windowControlStore.isIgnoringMouseEvent)

  return {
    width,
    height,
    centerPos,
    live2dLookAtX,
    live2dLookAtY,
    isCursorInside,
    shouldHideView,
  }
})
