/** URL-normalized loopback origin, including the HTTP default port. */
export function runtimeOrigin(port:number,host:'127.0.0.1'|'localhost'='127.0.0.1'):string{return new URL(`http://${host}:${port}`).origin}
export function runtimeAllowedOrigins(port:number):Set<string>{return new Set([runtimeOrigin(port),runtimeOrigin(port,'localhost'),runtimeOrigin(5178),runtimeOrigin(5178,'localhost')])}
