import { defineStore } from 'pinia'
import { ref } from 'vue'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpressionBlendMode = 'Add' | 'Multiply' | 'Overwrite'

/**
 * A single expression parameter entry tracked by the store.
 *
 * Each entry maps to a Live2D parameter that is controlled through the
 * expression system (either via exp3 files or direct parameter access).
 */
export interface ExpressionEntry {
  /** Human-readable name (Expression name or raw parameter ID). */
  name: string
  /** Live2D parameter ID (e.g. "ParamWatermarkOFF"). */
  parameterId: string
  /** How this value is applied on top of the base value. */
  blend: ExpressionBlendMode
  /** Runtime value that will be applied every frame. */
  currentValue: number
  /** Application-level default (may be overridden by the user via saveDefaults). */
  defaultValue: number
  /** Original default baked into the moc3 / exp3 file. */
  modelDefault: number
  /**
   * The exp3-specified target value for this parameter (e.g. -1, 1, 10).
   * Used by toggle to know what value to set when activating.
   * For parameters referenced by multiple groups, this stores the first
   * non-zero value encountered.
   */
  targetValue: number
  /** Active auto-reset timer handle, if any. */
  resetTimer?: ReturnType<typeof setTimeout>
}

/**
 * Describes a named expression group loaded from model3.json / exp3.json.
 *
 * One expression group can contain multiple parameter entries (e.g. "Cry"
 * may set both "ParamTear" and "ParamEyeWet").
 */
export interface ExpressionGroupDefinition {
  /** Expression name as declared in model3.json Expressions[].Name. */
  name: string
  /** Parameter entries that belong to this expression group. */
  parameters: {
    parameterId: string
    blend: ExpressionBlendMode
    value: number
  }[]
}

/** Serialisable snapshot returned to the LLM. */
export interface ExpressionState {
  name: string
  value: number
  default: number
  active: boolean
  autoResetAt?: number
}

/** Unified tool result envelope. */
export interface ExpressionToolResult {
  success: boolean
  error?: string
  state?: ExpressionState | ExpressionState[]
  available?: string[]
}

export type ExpressionLlmMode = 'all' | 'none' | 'custom'

/**
 * Durable expression choices for one display model.
 *
 * The account and localStorage both keep this shape so a second browser can
 * restore the same expression system after sign-in.
 */
export interface PersistedExpressionSettings {
  llmMode: ExpressionLlmMode
  llmExposed: Record<string, boolean>
  defaults: Record<string, number>
  /** Current parameter values, including preview toggles that are not yet saved as defaults. */
  values: Record<string, number>
  /**
   * Explicit on/off state for each expression group name.
   * Parameter values alone can look "active" when model defaults match exp3
   * targets, so account sync needs this map to restore the user's checkboxes.
   */
  activeGroups: Record<string, boolean>
  /**
   * Last local edit time for this blob.
   *
   * Account sync uses this for last-write-wins so a second browser cannot push
   * an older checkbox set over a newer one.
   */
  updatedAt?: string
}

const SETTINGS_KEY_PREFIX = 'expression-settings:'
const LEGACY_DEFAULTS_KEY_PREFIX = 'expression-defaults:'

// ---------------------------------------------------------------------------
// Persistence helpers  (localStorage – no extra dependency needed)
// ---------------------------------------------------------------------------

function settingsKey(modelId: string): string {
  return `${SETTINGS_KEY_PREFIX}${modelId}`
}

function legacyDefaultsKey(modelId: string): string {
  return `${LEGACY_DEFAULTS_KEY_PREFIX}${modelId}`
}

function clipRecord(record: Record<string, number | boolean>, maxEntries: number): Record<string, number | boolean> {
  const entries = Object.entries(record).slice(0, maxEntries)
  return Object.fromEntries(entries)
}

function normalizeSettings(raw: Partial<PersistedExpressionSettings> | null | undefined): PersistedExpressionSettings {
  const llmMode = raw?.llmMode === 'all' || raw?.llmMode === 'custom' ? raw.llmMode : 'none'
  const llmExposed: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(raw?.llmExposed ?? {})) {
    if (typeof value === 'boolean')
      llmExposed[name] = value
  }
  const defaults: Record<string, number> = {}
  for (const [name, value] of Object.entries(raw?.defaults ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value))
      defaults[name] = value
  }
  const values: Record<string, number> = {}
  for (const [name, value] of Object.entries(raw?.values ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value))
      values[name] = value
  }
  const activeGroups: Record<string, boolean> = {}
  for (const [name, value] of Object.entries(raw?.activeGroups ?? {})) {
    if (typeof value === 'boolean')
      activeGroups[name] = value
  }
  const updatedAt = typeof raw?.updatedAt === 'string' && Number.isFinite(Date.parse(raw.updatedAt))
    ? new Date(raw.updatedAt).toISOString()
    : undefined
  return {
    llmMode,
    llmExposed,
    defaults,
    values,
    activeGroups,
    ...(updatedAt ? { updatedAt } : {}),
  }
}

/**
 * Reads durable expression settings for one display model.
 *
 * @example
 * loadPersistedExpressionSettings('preset-live2d-1')
 * // => { llmMode: 'none', llmExposed: {}, defaults: {}, values: {} }
 */
export function loadPersistedExpressionSettings(modelId: string): PersistedExpressionSettings {
  if (!modelId)
    return normalizeSettings(undefined)

  try {
    const raw = localStorage.getItem(settingsKey(modelId))
    if (raw)
      return normalizeSettings(JSON.parse(raw) as Partial<PersistedExpressionSettings>)
  }
  catch {
    // Fall through to legacy defaults.
  }

  try {
    const legacy = localStorage.getItem(legacyDefaultsKey(modelId))
    if (!legacy)
      return normalizeSettings(undefined)
    const defaults = JSON.parse(legacy) as Record<string, number>
    return normalizeSettings({ llmMode: 'none', llmExposed: {}, defaults, values: { ...defaults }, activeGroups: {} })
  }
  catch {
    return normalizeSettings(undefined)
  }
}

/**
 * Writes durable expression settings for one display model.
 *
 * @param modelId - Display model that owns the settings.
 * @param settings - Settings to write.
 * @param options - Write options.
 * @param options.touch - Stamps `updatedAt` as now (the default), so account
 * sync treats this browser as the newer editor. Account apply passes false and
 * keeps the account timestamp.
 *
 * @example
 * savePersistedExpressionSettings('preset-live2d-1', {
 *   llmMode: 'custom',
 *   llmExposed: { f00: true },
 *   defaults: { ParamMouthOpenY: 0 },
 *   values: { ParamMouthOpenY: 1 },
 *   activeGroups: { f00: true },
 * })
 */
export function savePersistedExpressionSettings(
  modelId: string,
  settings: PersistedExpressionSettings,
  options?: { touch?: boolean },
): void {
  if (!modelId)
    return

  const touch = options?.touch !== false
  const next = normalizeSettings({
    llmMode: settings.llmMode,
    llmExposed: clipRecord(settings.llmExposed, 64) as Record<string, boolean>,
    defaults: clipRecord(settings.defaults, 128) as Record<string, number>,
    values: clipRecord(settings.values, 128) as Record<string, number>,
    activeGroups: clipRecord(settings.activeGroups, 64) as Record<string, boolean>,
    updatedAt: touch ? new Date().toISOString() : settings.updatedAt,
  })

  try {
    localStorage.setItem(settingsKey(modelId), JSON.stringify(next))
    // Keep the legacy key in sync so older builds still see saved defaults.
    localStorage.setItem(legacyDefaultsKey(modelId), JSON.stringify(next.defaults))
  }
  catch (err) {
    console.warn('[expression-store] Failed to persist settings:', err)
  }
}

/**
 * Lists every locally stored expression settings blob.
 *
 * Used when the account sync uploads all models this browser has adjusted.
 */
export function listPersistedExpressionSettings(): Array<{ modelId: string } & PersistedExpressionSettings> {
  const items: Array<{ modelId: string } & PersistedExpressionSettings> = []
  if (typeof localStorage === 'undefined')
    return items

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (!key?.startsWith(SETTINGS_KEY_PREFIX))
        continue
      const modelId = key.slice(SETTINGS_KEY_PREFIX.length)
      if (!modelId)
        continue
      items.push({ modelId, ...loadPersistedExpressionSettings(modelId) })
    }
  }
  catch {
    return items
  }

  return items.sort((a, b) => a.modelId.localeCompare(b.modelId)).slice(0, 32)
}

const VALUE_CHOICE_EPSILON = 1e-4

/**
 * True when the blob holds a real user choice, not just a dumped parameter table.
 *
 * A loaded model always writes default/value keys, and Live2D can leave tiny
 * float noise on parameters. Those alone must not count as expression choices,
 * or an idle browser will upload an empty checkbox set and wipe the account.
 */
export function hasExpressionChoices(settings: PersistedExpressionSettings): boolean {
  if (settings.llmMode !== 'none')
    return true
  if (Object.values(settings.llmExposed).some(Boolean))
    return true
  if (Object.values(settings.activeGroups).some(Boolean))
    return true
  for (const [name, value] of Object.entries(settings.values)) {
    const fallback = settings.defaults[name] ?? 0
    if (Math.abs(value - fallback) > VALUE_CHOICE_EPSILON)
      return true
  }
  return false
}

/**
 * Compares two expression-system blobs for account sync.
 *
 * @example
 * expressionSettingsEqual(
 *   { llmMode: 'custom', llmExposed: { f00: true }, defaults: {}, values: {} },
 *   { llmMode: 'custom', llmExposed: { f00: true }, defaults: {}, values: {} },
 * )
 * // => true
 */
export function expressionSettingsEqual(
  left: PersistedExpressionSettings,
  right: PersistedExpressionSettings,
): boolean {
  const a = normalizeSettings(left)
  const b = normalizeSettings(right)
  return a.llmMode === b.llmMode
    && JSON.stringify(a.llmExposed) === JSON.stringify(b.llmExposed)
    && JSON.stringify(a.defaults) === JSON.stringify(b.defaults)
    && JSON.stringify(a.values) === JSON.stringify(b.values)
    && JSON.stringify(a.activeGroups) === JSON.stringify(b.activeGroups)
}

/** Newest local edit time stored on the expression blob itself. */
export function expressionSettingsUpdatedAt(settings: PersistedExpressionSettings): string | null {
  return settings.updatedAt ?? null
}

/**
 * Compact signature of every stored expression settings blob.
 *
 * Account sync watches this string so an expression-only edit still schedules a push.
 */
export function expressionSettingsSignature(): string {
  return listPersistedExpressionSettings()
    .map((item) => {
      return `${item.modelId}:${item.llmMode}:${JSON.stringify(item.llmExposed)}:${JSON.stringify(item.defaults)}:${JSON.stringify(item.values)}:${JSON.stringify(item.activeGroups)}:${item.updatedAt ?? ''}`
    })
    .join('|')
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useExpressionStore = defineStore('live2d-expressions', () => {
  // ---- state ---------------------------------------------------------------

  /** Map keyed by expression/parameter name -> entry. */
  const expressions = ref<Map<string, ExpressionEntry>>(new Map())

  /** Currently loaded model ID (used for persistence scoping). */
  const modelId = ref<string>('')

  /**
   * Last model that registered expressions.
   *
   * A second Live2D preview can dispose the shared store and clear
   * {@link modelId} while the user still toggles checkboxes. Persist still
   * needs a stable key.
   */
  const lastModelId = ref<string>('')

  /**
   * Named expression groups parsed from model3.json + exp3.json.
   * Keyed by expression name.
   */
  const expressionGroups = ref<Map<string, ExpressionGroupDefinition>>(new Map())

  /** LLM exposure mode: 'all' exposes everything, 'none' exposes nothing, 'custom' uses per-group map. */
  const llmMode = ref<ExpressionLlmMode>('none')

  /** Per-group LLM exposure flags (only used when llmMode === 'custom'). */
  const llmExposed = ref<Map<string, boolean>>(new Map())

  /** Per-group checkbox state for account sync and the settings UI. */
  const activeGroups = ref<Map<string, boolean>>(new Map())

  /**
   * Bumps when durable expression settings change.
   * Account sync watches this so expression-only edits still upload.
   */
  const persistenceRevision = ref(0)

  /**
   * Expression group that the current stage emotion activated.
   *
   * The stage owns this value. A new emotion deactivates this group before it
   * applies its own group, so two emotions never stack. Manual toggles in the
   * settings UI do not change it, and `registerExpressions` forgets it because
   * a model swap replaces every entry.
   */
  const activeEmotionGroup = ref<string>()

  // ---- internal helpers ----------------------------------------------------

  function clearAllTimers() {
    for (const entry of expressions.value.values()) {
      if (entry.resetTimer != null) {
        clearTimeout(entry.resetTimer)
        entry.resetTimer = undefined
      }
    }
  }

  function toState(entry: ExpressionEntry): ExpressionState {
    return {
      name: entry.name,
      value: entry.currentValue,
      default: entry.defaultValue,
      active: entry.currentValue !== entry.defaultValue,
      autoResetAt: entry.resetTimer != null ? Date.now() : undefined,
    }
  }

  function allNames(): string[] {
    return Array.from(expressions.value.keys())
  }

  function persistenceModelId(): string {
    return modelId.value || lastModelId.value
  }

  function isGroupActiveByParameters(group: ExpressionGroupDefinition): boolean {
    return group.parameters.some((parameter) => {
      if (parameter.value === 0)
        return false
      const entry = expressions.value.get(parameter.parameterId)
      return entry != null && entry.currentValue === parameter.value
    })
  }

  /** Prefer the explicit checkbox map; fall back to parameter matching for old blobs. */
  function isGroupActive(name: string): boolean {
    if (activeGroups.value.has(name))
      return activeGroups.value.get(name) === true
    const group = expressionGroups.value.get(name)
    return group ? isGroupActiveByParameters(group) : false
  }

  function snapshotSettings(): PersistedExpressionSettings {
    const defaults: Record<string, number> = {}
    const values: Record<string, number> = {}
    for (const [name, entry] of expressions.value) {
      defaults[name] = entry.defaultValue
      values[name] = entry.currentValue
    }
    const exposed: Record<string, boolean> = {}
    for (const [name, value] of llmExposed.value)
      exposed[name] = value
    const groups: Record<string, boolean> = {}
    for (const [name, value] of activeGroups.value)
      groups[name] = value

    return {
      llmMode: llmMode.value,
      llmExposed: exposed,
      defaults,
      values,
      activeGroups: groups,
    }
  }

  function persistCurrentSettings() {
    const id = persistenceModelId()
    if (!id)
      return
    savePersistedExpressionSettings(id, snapshotSettings())
    persistenceRevision.value += 1
  }

  function applyGroupParameters(group: ExpressionGroupDefinition, active: boolean) {
    for (const param of group.parameters) {
      const entry = expressions.value.get(param.parameterId)
      if (!entry)
        continue
      applyValue(entry, active ? param.value : entry.modelDefault)
    }
  }

  function applyPersistedSettings(settings: PersistedExpressionSettings) {
    const normalized = normalizeSettings(settings)
    llmMode.value = normalized.llmMode
    llmExposed.value = new Map(Object.entries(normalized.llmExposed))
    activeGroups.value = new Map(Object.entries(normalized.activeGroups))

    for (const [name, defaultVal] of Object.entries(normalized.defaults)) {
      const entry = expressions.value.get(name)
      if (!entry)
        continue
      entry.defaultValue = defaultVal
    }

    // Apply group on/off first, then precise parameter values so an account
    // blob that stores both keeps the saved numbers.
    if (Object.keys(normalized.activeGroups).length > 0) {
      for (const [name, active] of Object.entries(normalized.activeGroups)) {
        const group = expressionGroups.value.get(name)
        if (group)
          applyGroupParameters(group, active)
      }
    }

    const valueSource = Object.keys(normalized.values).length > 0 ? normalized.values : normalized.defaults
    for (const [name, value] of Object.entries(valueSource)) {
      const entry = expressions.value.get(name)
      if (!entry)
        continue
      entry.currentValue = value
    }
  }

  // ---- public API ----------------------------------------------------------

  /**
   * Register all expression entries parsed from the model.
   * Called by the expression-controller after parsing exp3 data.
   */
  function registerExpressions(
    id: string,
    groups: ExpressionGroupDefinition[],
    parameterEntries: ExpressionEntry[],
  ) {
    clearAllTimers()
    expressions.value = new Map()
    expressionGroups.value = new Map()
    activeGroups.value = new Map()
    activeEmotionGroup.value = undefined
    modelId.value = id
    if (id)
      lastModelId.value = id

    // Register expression groups
    for (const group of groups) {
      expressionGroups.value.set(group.name, group)
    }

    // Register individual parameter entries
    for (const entry of parameterEntries) {
      expressions.value.set(entry.name, { ...entry })
    }

    const persisted = loadPersistedExpressionSettings(id)
    applyPersistedSettings(persisted)
    // Migrate legacy defaults into the unified settings key once.
    let hasUnifiedKey = false
    try {
      hasUnifiedKey = localStorage.getItem(settingsKey(id)) != null
    }
    catch {
      hasUnifiedKey = false
    }
    if (!hasUnifiedKey && (Object.keys(persisted.defaults).length > 0 || hasExpressionChoices(persisted)))
      savePersistedExpressionSettings(id, snapshotSettings())
  }

  /**
   * Writes account-synced expression settings into local storage and, when the
   * matching model is loaded, into the live store.
   */
  function applyAccountSettings(id: string, settings: PersistedExpressionSettings) {
    if (id)
      lastModelId.value = id
    // Keep the account timestamp. Touching here would make a stale browser
    // look newer than the account and push old checkboxes back up.
    savePersistedExpressionSettings(id, settings, { touch: false })
    persistenceRevision.value += 1
    if (modelId.value === id || lastModelId.value === id)
      applyPersistedSettings(normalizeSettings(settings))
  }

  /**
   * Resolve a name to either an expression group or a direct parameter entry.
   * Returns `'group'`, `'param'`, or `null`.
   */
  function resolve(name: string): { kind: 'group', group: ExpressionGroupDefinition } | { kind: 'param', entry: ExpressionEntry } | null {
    const group = expressionGroups.value.get(name)
    if (group)
      return { kind: 'group', group }

    const entry = expressions.value.get(name)
    if (entry)
      return { kind: 'param', entry }

    return null
  }

  /**
   * Set an expression or parameter value.
   */
  function set(name: string, value: boolean | number, duration?: number): ExpressionToolResult {
    const resolved = resolve(name)

    if (!resolved) {
      return {
        success: false,
        error: `Expression or parameter "${name}" not found.`,
        available: allNames(),
      }
    }

    const numericValue = typeof value === 'boolean' ? (value ? 1 : 0) : value

    if (resolved.kind === 'group') {
      const states: ExpressionState[] = []
      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry) {
          applyValue(entry, numericValue, duration)
          states.push(toState(entry))
        }
      }
      persistCurrentSettings()
      return { success: true, state: states }
    }

    // Direct parameter
    applyValue(resolved.entry, numericValue, duration)
    persistCurrentSettings()
    return { success: true, state: toState(resolved.entry) }
  }

  /**
   * Get expression state.
   */
  function get(name?: string): ExpressionToolResult {
    if (!name) {
      // Return all
      const states: ExpressionState[] = []
      for (const entry of expressions.value.values()) {
        states.push(toState(entry))
      }
      return { success: true, state: states }
    }

    const resolved = resolve(name)
    if (!resolved) {
      return {
        success: false,
        error: `Expression or parameter "${name}" not found.`,
        available: allNames(),
      }
    }

    if (resolved.kind === 'group') {
      const states: ExpressionState[] = []
      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry)
          states.push(toState(entry))
      }
      return { success: true, state: states }
    }

    return { success: true, state: toState(resolved.entry) }
  }

  /**
   * Toggle an expression (flip between default and non-default).
   */
  function toggle(name: string, duration?: number): ExpressionToolResult {
    const resolved = resolve(name)
    if (!resolved) {
      return {
        success: false,
        error: `Expression or parameter "${name}" not found.`,
        available: allNames(),
      }
    }

    if (resolved.kind === 'group') {
      const isActive = isGroupActive(name)
      const nextActive = !isActive
      activeGroups.value.set(name, nextActive)
      const states: ExpressionState[] = []
      for (const param of resolved.group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry) {
          const newValue = nextActive ? param.value : entry.modelDefault
          applyValue(entry, newValue, duration)
          states.push(toState(entry))
        }
      }
      persistCurrentSettings()
      return { success: true, state: states }
    }

    // Direct parameter toggle: flip between modelDefault and exp3 target value
    const entry = resolved.entry
    const newValue = entry.currentValue !== entry.modelDefault ? entry.modelDefault : entry.targetValue
    applyValue(entry, newValue, duration)
    persistCurrentSettings()
    return { success: true, state: toState(entry) }
  }

  /** Sets one expression group checkbox and persists for account sync. */
  function setGroupActive(name: string, active: boolean): ExpressionToolResult {
    const resolved = resolve(name)
    if (!resolved || resolved.kind !== 'group') {
      return {
        success: false,
        error: `Expression group "${name}" not found.`,
        available: [...expressionGroups.value.keys()],
      }
    }
    activeGroups.value.set(name, active)
    applyGroupParameters(resolved.group, active)
    persistCurrentSettings()
    return { success: true }
  }

  /**
   * Applies one expression group for the stage emotion channel.
   *
   * The emotion channel owns the face, so every other group returns to its
   * identity value first. Two groups share parameters (Haru `f03` and `f06`
   * both write `ParamBrowLY`), and a group that the settings UI toggled must
   * not stay on top of the emotion. Without that reset, the second emotion
   * looks stuck on the first one.
   *
   * `intensity` moves each parameter from the blend identity to the value in the
   * exp3 file. An intensity of 1 gives the exact exp3 result. An intensity of 0
   * restores the model default. Values outside 0–1 are clamped.
   *
   * Group names match without case, because model3.json can declare `Happy` or
   * `happy`.
   */
  function activateEmotionGroup(name: string, intensity = 1): ExpressionToolResult {
    const group = findEmotionGroup(name)
    if (!group) {
      return {
        success: false,
        error: `Expression group "${name}" not found.`,
        available: Array.from(expressionGroups.value.keys()),
      }
    }

    clearEveryGroup()

    const strength = Math.min(1, Math.max(0, intensity))
    const states: ExpressionState[] = []
    for (const param of group.parameters) {
      const entry = expressions.value.get(param.parameterId)
      if (!entry)
        continue

      const identity = emotionBlendIdentity(entry)
      applyValue(entry, identity + (param.value - identity) * strength)
      states.push(toState(entry))
    }

    activeEmotionGroup.value = group.name
    return { success: true, state: states }
  }

  /**
   * Restores the neutral face: every group returns to its identity value.
   *
   * The call covers groups that the settings UI toggled, so `neutral` also
   * undoes a manual preview. It stays safe to call on every `neutral` emotion.
   */
  function clearEmotionGroup(): ExpressionToolResult {
    activeEmotionGroup.value = undefined
    clearEveryGroup()
    return { success: true }
  }

  /**
   * Save current values as defaults (persisted across restarts).
   */
  function saveDefaults(): ExpressionToolResult {
    if (!modelId.value) {
      return { success: false, error: 'No model loaded.' }
    }

    for (const entry of expressions.value.values())
      entry.defaultValue = entry.currentValue

    persistCurrentSettings()
    return { success: true }
  }

  /**
   * Reset all expressions to their default values.
   */
  function resetAll(): ExpressionToolResult {
    clearAllTimers()
    activeEmotionGroup.value = undefined
    const states: ExpressionState[] = []
    for (const entry of expressions.value.values()) {
      entry.currentValue = entry.modelDefault
      states.push(toState(entry))
    }
    for (const name of expressionGroups.value.keys())
      activeGroups.value.set(name, false)
    persistCurrentSettings()
    return { success: true, state: states }
  }

  /**
   * Clears live expression state for one Live2D instance.
   *
   * Keeps {@link lastModelId} so a late checkbox click can still write the
   * account blob after another preview disposes this store. Does not persist
   * empty parameter dumps — that minted a fresher `updatedAt` and blocked
   * account apply on the next load.
   */
  function dispose() {
    const id = persistenceModelId()
    if (id && hasExpressionChoices(snapshotSettings()))
      persistCurrentSettings()
    clearAllTimers()
    expressions.value = new Map()
    expressionGroups.value = new Map()
    llmMode.value = 'none'
    llmExposed.value = new Map()
    activeGroups.value = new Map()
    activeEmotionGroup.value = undefined
    modelId.value = ''
  }

  // ---- LLM exposure --------------------------------------------------------

  function setLlmMode(mode: ExpressionLlmMode) {
    llmMode.value = mode
    persistCurrentSettings()
  }

  function setLlmExposed(name: string, value: boolean) {
    llmExposed.value.set(name, value)
    persistCurrentSettings()
  }

  /** Check if a specific expression group is exposed to LLM tools. */
  function isExposedToLlm(name: string): boolean {
    if (llmMode.value === 'all')
      return true
    if (llmMode.value === 'none')
      return false
    return llmExposed.value.get(name) ?? false
  }

  // ---- private -------------------------------------------------------------

  /**
   * Returns every expression group to its identity value.
   *
   * The stage owns the face while a reply plays. A group that the settings UI
   * toggled must not survive an emotion, because two groups share parameters
   * (Haru `f03` and `f06` both write `ParamBrowLY`) and the face then shows a
   * mix of both. The checkbox state follows the face, so the settings page does
   * not claim a group that is no longer applied.
   */
  function clearEveryGroup() {
    for (const group of expressionGroups.value.values()) {
      for (const param of group.parameters) {
        const entry = expressions.value.get(param.parameterId)
        if (entry)
          applyValue(entry, emotionBlendIdentity(entry))
      }
    }

    for (const name of expressionGroups.value.keys())
      activeGroups.value.set(name, false)
  }

  function applyValue(entry: ExpressionEntry, value: number, duration?: number) {
    // Cancel existing timer
    if (entry.resetTimer != null) {
      clearTimeout(entry.resetTimer)
      entry.resetTimer = undefined
    }

    entry.currentValue = value

    // Schedule auto-reset if duration > 0
    if (duration && duration > 0) {
      const resetTo = entry.defaultValue
      entry.resetTimer = setTimeout(() => {
        entry.currentValue = resetTo
        entry.resetTimer = undefined
        persistCurrentSettings()
      }, duration * 1000)
    }
  }

  /**
   * Returns the parameter value that has no visual effect for a blend mode.
   *
   * `applyValue` writes the value, so an identity write removes the group from
   * the next frame without a separate reset path.
   */
  function emotionBlendIdentity(entry: ExpressionEntry): number {
    switch (entry.blend) {
      case 'Add':
        return 0
      case 'Multiply':
        return 1
      default:
        return entry.modelDefault
    }
  }

  /** Case-insensitive group lookup, because model3.json names vary in case. */
  function findEmotionGroup(name: string): ExpressionGroupDefinition | undefined {
    const direct = expressionGroups.value.get(name)
    if (direct)
      return direct

    const lower = name.toLowerCase()
    for (const group of expressionGroups.value.values()) {
      if (group.name.toLowerCase() === lower)
        return group
    }
    return undefined
  }

  return {
    // State (read-only externally, but reactive)
    expressions,
    modelId,
    lastModelId,
    expressionGroups,
    llmMode,
    llmExposed,
    activeGroups,
    persistenceRevision,
    activeEmotionGroup,

    // Actions
    registerExpressions,
    applyAccountSettings,
    resolve,
    set,
    get,
    toggle,
    setGroupActive,
    isGroupActive,
    activateEmotionGroup,
    clearEmotionGroup,
    saveDefaults,
    resetAll,
    dispose,
    setLlmMode,
    setLlmExposed,
    isExposedToLlm,
  }
})
