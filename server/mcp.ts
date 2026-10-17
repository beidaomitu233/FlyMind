// Select before importing either implementation: never init legacy storage in native pilot.
if(process.env.FLYMIND_NATIVE_PILOT==='1')await import('./mcp-native/index')
else await import('./mcp-legacy')
export {}
