import { AsyncLocalStorage } from 'node:async_hooks';

// Phone memory and HQ voice share helpers with ordinary chat. Keep their
// model selection local to the request, including asynchronous sidecar work.
const scope = new AsyncLocalStorage<'phone'>();
export function isPhoneTextModelScope(): boolean { return scope.getStore() === 'phone'; }
export function withPhoneTextModel<T>(work: () => T): T { return scope.run('phone', work); }
