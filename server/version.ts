import { readFile } from 'node:fs/promises'

// Runtime and MCP report the same version as the installed source package.
export const VERSION:string=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version
