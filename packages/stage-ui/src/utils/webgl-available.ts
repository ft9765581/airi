/**
 * Reports whether this browser can create a WebGL drawing context.
 *
 * VRM and MMD stages need WebGL. Some hosts (embedded IDE browsers, locked-down
 * GPUs) refuse context creation. Callers must show a stage error instead of
 * mounting Tres/Three, because a failed `WebGLRenderer` constructor throws in
 * `setup` and can tear down the whole page through the route error boundary.
 */
export function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined')
    return false

  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
      || canvas.getContext('webgl')
      || canvas.getContext('experimental-webgl')
    if (!gl || typeof (gl as WebGLRenderingContext).getExtension !== 'function')
      return false

    const lose = (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')
    lose?.loseContext()
    return true
  }
  catch {
    return false
  }
}

/** Renderers that construct a Three.js `WebGLRenderer` during setup. */
export function stageRendererNeedsWebGL(renderer: string | undefined): boolean {
  return renderer === 'vrm' || renderer === 'mmd'
}
