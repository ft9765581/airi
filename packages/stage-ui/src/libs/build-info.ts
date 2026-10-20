/**
 * Identifies the build that this browser runs.
 *
 * A deployment needs this value in two places: the support panel shows all of
 * it, and the stage corner shows a short form.
 */
export interface BuildInfo {
  /** Defaults version that the build carries, empty when it ships no defaults. */
  configVersion: string
  /**
   * File name of the application bundle that this document loaded.
   *
   * Vite writes a content hash into the name, so the value changes with every
   * build. Development serves modules instead of a bundle, so the value is
   * empty there.
   */
  buildFile: string
}

/**
 * Reads the identity of the running build.
 *
 * @example
 * readBuildInfo()
 * // => { configVersion: '2026-10-14.19', buildFile: 'index-C75r7gTL.js' }
 */
export function readBuildInfo(): BuildInfo {
  const configVersion = import.meta.env.VITE_DEFAULT_CONFIG_VERSION ?? ''
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
  const entry = scripts
    .map(script => script.getAttribute('src') ?? '')
    .find(src => /\/assets\/index-[\w-]+\.js$/.test(src))

  return {
    configVersion,
    buildFile: entry ? entry.split('/').pop() ?? entry : '',
  }
}
