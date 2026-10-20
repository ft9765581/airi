import { DisplayModelFormat, registerDisplayModelPreset } from '@proj-airi/stage-ui/stores/display-models'

/**
 * Registers the display models that this deployment ships.
 *
 * The package lives in `public/models`, so it is served from the site root and
 * the browser downloads it on first use. `importedAt` is fixed: it only orders
 * the model list, and a fixed value keeps that order stable between builds.
 *
 * The preview image comes from the application renderer for imported models, so
 * the model picker shows the character before the browser downloads the
 * package.
 */
export function registerStageDisplayModelPresets(): void {
  registerDisplayModelPreset({
    id: 'preset-live2d-chun-nurse',
    format: DisplayModelFormat.Live2dZip,
    type: 'url',
    url: '/models/live2d/chun-nurse-white.zip',
    name: '春 · 护士白裤子版',
    previewImage: '/models/live2d/chun-nurse-white.preview.png',
    importedAt: 1791900000000,
  })
}
