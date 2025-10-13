import { defineInvoke } from '@unbird/eventa'
import { createContext } from '@unbird/eventa/adapters/electron/renderer'
import { ref } from 'vue'

import { electronCursorPoint, electronStartTrackingCursorPoint } from '../../shared/eventa'

export function useWindowMouse(options?: { x: number, y: number }) {
  const context = ref(createContext(window.electron.ipcRenderer).context)
  const centerPosition = ref<{ x: number, y: number }>({ x: 0, y: 0 })
  const positionX = ref(options?.x ?? 0)
  const positionY = ref(options?.y ?? 0)

  context.value!.on(electronCursorPoint, (event) => {
    positionX.value = event.body?.x ?? centerPosition.value.x
    positionY.value = event.body?.y ?? centerPosition.value.y
  })

  defineInvoke(context.value!, electronStartTrackingCursorPoint)()

  return {
    x: positionX,
    y: positionY,
  }
}
