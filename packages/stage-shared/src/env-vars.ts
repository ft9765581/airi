/**
 * Returns true if the provided environment variable represents a truthy value.
 *
 * Truthy values: `true`, `t`, `yes`, `y`, `on`, `1`
 */
export function isEnvTruthy(value: string | undefined | null): boolean {
  if (value == null)
    return false
  return /^(?:1|true|t|yes|y|on)$/i.test(value.trim())
}

export function isFluxPurchaseDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_FLUX_PURCHASE)
}

export function isCustomProvidersDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_CUSTOM_PROVIDERS)
}

/**
 * A deployment that runs no mods server channel sets this flag.
 *
 * The channel is a local WebSocket (`ws://localhost:6121/ws`) that drives mods
 * and remote control. Without the flag every visitor attempts that connection,
 * fails, and the browser console fills with retry errors.
 */
export function isServerChannelDisabled(): boolean {
  return isEnvTruthy(import.meta.env.VITE_DISABLE_SERVER_CHANNEL)
}
