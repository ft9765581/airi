import type {} from 'pinia-plugin-synced'

import type { InferenceServiceProvider, ProviderValidationStatus } from '../../libs/providers/types'

import { useMutation, useQuery } from '@pinia/colada'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { client } from '../../composables/api'
import { getDefinedProvider } from '../../libs/providers'
import { inferenceServiceProvidersService as service } from '../../services/inference-service-providers'
import { useAuthStore } from '../auth'

const PROVIDERS_QUERY_KEY = ['inference-service-providers']
const providerStorageOptions = {
  // pinia-plugin-synced is the only cross-window propagation channel for this
  // store. Listening to storage events would feed replicated state back into
  // the leader as a new state proposal.
  listenToStorageChanges: false,
} as const

/**
 * Creates the remote provider-list query.
 *
 * The query returns a remote snapshot. The Provider Config Store merges that snapshot
 * into its persisted, cross-window state after the request succeeds.
 */
function createProvidersQueryOptions() {
  return {
    key: PROVIDERS_QUERY_KEY,
    query: async (context: { signal: AbortSignal }) => {
      const remote = await service.fetchRemote(client, { abortSignal: context.signal })
      return remote
    },
    enabled: false,
  }
}

/**
 * Stores serializable provider instances and their configuration.
 *
 * Pinia Colada owns remote request state. This store remains the source of
 * truth for the local, cross-window provider snapshot.
 */
export const useProviderConfigStore = defineStore('provider-config', () => {
  const providers = useLocalStorage<Record<string, InferenceServiceProvider>>('settings/providers/configured', {}, providerStorageOptions)
  const addedProviders = useLocalStorage<Record<string, boolean>>('settings/providers/added', {}, providerStorageOptions)
  const legacyConfigs = useLocalStorage<Record<string, Record<string, unknown>>>('settings/credentials/providers', {}, providerStorageOptions)

  // `stores/auth` states that it does not import this store, so this direction
  // cannot create a cycle. The sign-in and sign-out hooks below need it.
  const authStore = useAuthStore()

  // Import the previous provider configuration shape once. Provider ids remain
  // stable, so existing model selections keep pointing at the same provider.
  for (const [providerId, config] of Object.entries(legacyConfigs.value)) {
    if (providers.value[providerId])
      continue

    const definitionId = providerId.startsWith('vision-')
      ? providerId.slice('vision-'.length)
      : providerId
    const definition = getDefinedProvider(definitionId)
    if (!definition)
      continue

    providers.value[providerId] = {
      id: providerId,
      definitionId,
      config,
      status: 'unconfigured',
      configuredBy: definition.configuredBy ?? 'user',
    }
  }

  // Provider definitions own configuration lifecycle policy. Apply that
  // policy to persisted snapshots before module pages consume them. Providers
  // without an owner declaration remain user-configured.
  for (const provider of Object.values(providers.value)) {
    const configuredByDefinition = getDefinedProvider(provider.definitionId)?.configuredBy
    if (configuredByDefinition) {
      provider.configuredBy = configuredByDefinition
    }
    else if (!provider.configuredBy) {
      provider.configuredBy = 'user'
    }
  }

  const providersQuery = useQuery(createProvidersQueryOptions())
  const addProviderMutation = useMutation({
    mutation: async (provider: InferenceServiceProvider) => service.createRemote(client, provider),
  })
  const removeProviderMutation = useMutation({
    mutation: async (providerId: string) => service.deleteRemote(client, providerId),
  })
  const updateProviderMutation = useMutation({
    mutation: async (payload: {
      providerId: string
      config: Record<string, unknown>
      status: ProviderValidationStatus
    }) => service.patchConfigRemote(client, payload.providerId, payload.config, payload.status),
  })

  const configs = computed(() => Object.fromEntries(
    Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.config]),
  ))
  const listedProviders = computed(() => Object.fromEntries(
    Object.entries(providers.value).filter(([providerId]) => addedProviders.value[providerId]),
  ))
  const configuredProviders = computed(() => Object.fromEntries(
    Object.entries(providers.value).map(([providerId, provider]) => [providerId, provider.status === 'configured']),
  ))
  const mutationError = computed(() =>
    addProviderMutation.error.value
    ?? removeProviderMutation.error.value
    ?? updateProviderMutation.error.value)

  function getProvider(providerId: string) {
    return providers.value[providerId]
  }

  function getProviderConfig(providerId: string) {
    return providers.value[providerId]?.config
  }

  function ensureProvider(providerId: string, definitionId: string, config: Record<string, unknown> = {}) {
    const current = providers.value[providerId]
    if (current)
      return current

    const definition = getDefinedProvider(definitionId)
    if (!definition)
      throw new Error(`Provider definition with id "${definitionId}" not found.`)

    const provider = {
      id: providerId,
      definitionId,
      config,
      status: 'unconfigured' as const,
      configuredBy: definition.configuredBy ?? 'user',
    }
    providers.value[providerId] = provider
    return provider
  }

  function updateProviderConfigFields(providerId: string, definitionId: string, patch: Record<string, unknown>) {
    const provider = ensureProvider(providerId, definitionId)
    const normalizedPatch = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [key, key === 'apiKey' && typeof value === 'string' ? value.trim() : value]),
    )

    Object.assign(provider.config, normalizedPatch)
    // A synchronized action result crosses a `structuredClone` boundary, and a
    // Vue reactive proxy fails that clone. Callers read the stored value, so
    // this action returns nothing.
  }

  function markProviderAdded(providerId: string) {
    addedProviders.value[providerId] = true
  }

  function unmarkProviderAdded(providerId: string) {
    delete addedProviders.value[providerId]
  }

  function setProviderStatus(providerId: string, status: ProviderValidationStatus) {
    const provider = providers.value[providerId]
    if (provider)
      provider.status = status
  }

  function mergeProviderSnapshot(snapshot: Record<string, InferenceServiceProvider>) {
    providers.value = { ...providers.value, ...snapshot }
    for (const providerId of Object.keys(snapshot))
      markProviderAdded(providerId)
  }

  /**
   * Brings this browser and the account's stored configuration in line.
   *
   * The server is authoritative for the providers it holds, so a second device
   * shows the same set. A server that holds nothing is the first sign-in of this
   * account, so the providers this browser already has go up: that carries the
   * deployment defaults and anything the visitor configured before signing in.
   *
   * A failed request leaves the local snapshot alone, so the store keeps working
   * offline and the next sign-in tries again.
   *
   * This stays a synchronized action. The sign-in hook calls it, and a follower
   * window must ask the leader rather than write the replicated snapshot itself.
   */
  async function fetchProviders() {
    let remote: Record<string, InferenceServiceProvider>
    try {
      const state = await providersQuery.refetch(true)
      if (!state.data)
        return providers.value
      remote = state.data
    }
    catch {
      // The merged local snapshot is authoritative while the remote endpoint is unavailable.
      return providers.value
    }

    if (Object.keys(remote).length > 0) {
      // The server snapshot has the highest priority for ids that exist remotely.
      mergeProviderSnapshot(remote)
      return providers.value
    }

    if (!authStore.isAuthenticated)
      return providers.value

    for (const provider of Object.values(providers.value)) {
      try {
        await addProviderMutation.mutateAsync(provider)
      }
      catch {
        // One rejected provider must not stop the remaining ones from uploading.
      }
    }

    return providers.value
  }

  async function addProvider(definitionId: string, initialConfig: Record<string, unknown> = {}) {
    const provider = service.buildLocal(definitionId, initialConfig)
    providers.value[provider.id] = provider
    markProviderAdded(provider.id)

    try {
      const remote = await addProviderMutation.mutateAsync(provider)
      delete providers.value[provider.id]
      unmarkProviderAdded(provider.id)
      providers.value[remote.id] = remote
      markProviderAdded(remote.id)
      return remote
    }
    catch {
      // A failed remote create does not discard the local provider.
      return provider
    }
  }

  async function removeProvider(providerId: string) {
    if (!providers.value[providerId])
      return

    delete providers.value[providerId]
    unmarkProviderAdded(providerId)

    try {
      await removeProviderMutation.mutateAsync(providerId)
    }
    catch {
      // A failed remote delete does not restore a provider that the user removed locally.
    }
  }

  async function updateProviderConfig(providerId: string, config: Record<string, unknown>, status: ProviderValidationStatus) {
    const provider = providers.value[providerId]
    if (!provider)
      return

    const localProvider = {
      ...provider,
      config: { ...config },
      status,
    }
    providers.value[providerId] = localProvider

    try {
      const remote = await updateProviderMutation.mutateAsync({ providerId, config, status })
      providers.value[remote.id] = remote
      return remote
    }
    catch {
      // A failed remote update keeps the local provider configuration.
      return localProvider
    }
  }

  async function resetProviders() {
    providers.value = {}
    addedProviders.value = {}
  }

  // The account owns its provider configuration, so signing in brings this
  // browser in line with it. Signing out clears the local copy: without that,
  // the next account to sign in on this browser would inherit these providers
  // and upload them to its own account. The deployment seeds its defaults again
  // on the next start.
  authStore.onAuthenticated(() => void fetchProviders())
  authStore.onLogout(() => void resetProviders())

  return {
    providers,
    configs,
    addedProviders,
    listedProviders,
    configuredProviders,
    isLoading: computed(() => providersQuery.isLoading.value),
    error: computed(() => providersQuery.error.value),
    mutationError,

    getProvider,
    getProviderConfig,
    ensureProvider,
    updateProviderConfigFields,
    markProviderAdded,
    unmarkProviderAdded,
    setProviderStatus,
    fetchProviders,
    addProvider,
    removeProvider,
    updateProviderConfig,
    resetProviders,
  }
}, {
  synced: {
    actions: [
      'fetchProviders',
      'ensureProvider',
      'updateProviderConfigFields',
      'markProviderAdded',
      'unmarkProviderAdded',
      'setProviderStatus',
      'addProvider',
      'removeProvider',
      'updateProviderConfig',
      'resetProviders',
    ],
    state: true,
  },
})
