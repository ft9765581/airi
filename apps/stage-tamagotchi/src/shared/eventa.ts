import type { Point } from 'electron'

import { defineEventa, defineInvokeEventa } from '@unbird/eventa'

export const electronMousePosition = defineEventa<Point>('electron:eventa:event:mouse-position')
export const electronStartTrackMousePosition = defineInvokeEventa('electron:eventa:invoke:start-tracking-mouse-position')
export const electronStartDraggingWindow = defineInvokeEventa('electron:eventa:invoke:start-dragging-window')
export const electronOpenMainDevtools = defineInvokeEventa('electron:eventa:invoke:windows:main:devtools:open')
export const electronOpenSettings = defineInvokeEventa('electron:eventa:invoke:windows:settings:open')
export const electronOpenSettingsDevtools = defineInvokeEventa('electron:eventa:invoke:windows:settings:devtools:open')

export { electron } from './electron'
