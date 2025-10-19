import { defineEventa, defineInvokeEventa } from '@unbird/eventa'

export const electronStartTrackMousePosition = defineInvokeEventa('eventa:invoke:electron:start-tracking-mouse-position')
export const electronStartDraggingWindow = defineInvokeEventa('eventa:invoke:electron:start-dragging-window')
export const electronOpenMainDevtools = defineInvokeEventa('eventa:invoke:electron:windows:main:devtools:open')
export const electronOpenSettings = defineInvokeEventa('eventa:invoke:electron:windows:settings:open')
export const electronOpenSettingsDevtools = defineInvokeEventa('eventa:invoke:electron:windows:settings:devtools:open')
export const captionAttachedChanged = defineEventa<boolean>('eventa:event:electron:windows:caption-overlay:attached-changed')
export const captionGetAttached = defineInvokeEventa<boolean>('eventa:invoke:electron:windows:caption-overlay:get-attached')

export { electron } from './electron'
