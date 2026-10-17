import {existsSync,readFileSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

/** Source and precompiled modules share the installed package, never cwd. */
export function findPackageRoot(moduleURL:string=import.meta.url):string{
 let directory=dirname(fileURLToPath(moduleURL))
 for(;;){if(existsSync(join(directory,'package.json'))&&existsSync(join(directory,'server/start.mjs')))return directory;const parent=dirname(directory);if(parent===directory)throw Error('FLYMIND_PACKAGE_ROOT_MISSING');directory=parent}
}
export const PACKAGE_ROOT=findPackageRoot()
export const RESOURCE_ROOT=resolve(process.env.FLYMIND_RESOURCES_DIR||join(PACKAGE_ROOT,'resources'))
export const PACKAGE_VERSION:string=JSON.parse(readFileSync(join(PACKAGE_ROOT,'package.json'),'utf8')).version
