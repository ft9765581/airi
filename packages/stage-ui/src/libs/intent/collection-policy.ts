import type { RemoteIntentCollection, RemoteIntentCollectionPurpose } from './api'

/**
 * Which collection a surface may use.
 *
 * An acceptance set only means something if it was never used to tune the
 * classifier, so the bench cannot select one: opening an acceptance set there and
 * iterating on prompts would quietly turn it into a development set
 * (intent-routing.md §7.6, "验收集只用于最终验收").
 */

/** The surface asking for a collection. */
export type CollectionSurface = 'bench' | 'acceptance'

/** Collections a surface may offer, in the order the API returned them. */
export function collectionsFor(surface: CollectionSurface, collections: readonly RemoteIntentCollection[]): RemoteIntentCollection[] {
  return collections.filter(collection => surface === 'acceptance'
    ? collection.purpose === 'acceptance'
    : collection.purpose === 'development')
}

/**
 * Why a stored selection cannot be used here, or nothing when it can.
 *
 * The bench keeps its selection in local storage, which outlives the page. An
 * acceptance id left there must block the run with a sentence, not silently run.
 *
 * @example
 * collectionBlockedReason('bench', { purpose: 'acceptance' } as RemoteIntentCollection)
 * // => '验收集只在最终验收时使用，测试台不能选它'
 */
export function collectionBlockedReason(surface: CollectionSurface, collection: Pick<RemoteIntentCollection, 'purpose'> | undefined): string | undefined {
  if (!collection)
    return undefined

  const allowed: RemoteIntentCollectionPurpose = surface === 'acceptance' ? 'acceptance' : 'development'
  if (collection.purpose === allowed)
    return undefined

  return surface === 'bench'
    ? '验收集只在最终验收时使用，测试台不能选它'
    : '开发集不能在验收里运行，请选择验收集'
}
