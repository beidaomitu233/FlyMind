// Shipped v1.1 entry never falls back to a direct, unguarded legacy store.
// Legacy source development must explicitly invoke mcp-legacy.ts itself.
import {localRuntimeAuthorization} from './local-auth/runtime'
localRuntimeAuthorization()
await import('./mcp-native/index')
export {}
