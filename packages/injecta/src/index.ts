import {
  invoke as globalInvoke,
  provide as globalProvide,
  start as globalStart,
  stop as globalStop,
} from './global'

export type { Lifecycle } from './builtin'

export {
  createContainer,
  invoke,
  provide,
  start,
  stop,
} from './scoped'

export type {
  BuildContext,
  Container,
  DependencyMap,
  InvokeOption,
  InvokeOptionFunc,
  InvokeOptionObject,
  ProvideOption,
  ProvideOptionFunc,
  ProvideOptionObject,
} from './scoped'

export const injecta = {
  provide: globalProvide,
  invoke: globalInvoke,
  start: globalStart,
  stop: globalStop,
}
