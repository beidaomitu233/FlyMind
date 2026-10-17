// Build-time only. TypeScript is never required by the installed CLI.
import ts from 'typescript'
import {readFile,writeFile,mkdir,readdir,rm,access} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname,resolve,relative,join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),output=resolve(root,'lib')
if(dirname(output)!==root||output!==join(root,'lib'))throw Error('UNSAFE_BUILD_PATH')
await rm(output,{recursive:true,force:true});await mkdir(output)
function specifier(value,file){
 if(!value.startsWith('.'))return value
 const target=resolve(dirname(file),value)
 if(value.endsWith('.ts'))return value.slice(0,-3)+'.js'
 if(existsSync(target+'.ts'))return value+'.js'
 if(existsSync(join(target,'index.ts')))return value.replace(/\/$/,'')+'/index.js'
 return value
}
function transformer(file){return context=>source=>{
 const visit=node=>{
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier))return ts.factory.updateImportDeclaration(node,node.modifiers,node.importClause,ts.factory.createStringLiteral(specifier(node.moduleSpecifier.text,file)),node.attributes)
  if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))return ts.factory.updateExportDeclaration(node,node.modifiers,node.isTypeOnly,node.exportClause,ts.factory.createStringLiteral(specifier(node.moduleSpecifier.text,file)),node.attributes)
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments.length&&ts.isStringLiteral(node.arguments[0]))return ts.factory.updateCallExpression(node,node.expression,node.typeArguments,[ts.factory.createStringLiteral(specifier(node.arguments[0].text,file)),...node.arguments.slice(1)])
  return ts.visitEachChild(node,visit,context)
 };return ts.visitNode(source,visit)
}}
let count=0
async function emit(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())await emit(file);else if(entry.name.endsWith('.ts')&&!entry.name.endsWith('.d.ts')){
 const result=ts.transpileModule(await readFile(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:false},transformers:{after:[transformer(file)]}})
 const target=join(output,relative(root,file).replace(/\.ts$/,'.js'));await mkdir(dirname(target),{recursive:true});await writeFile(target,result.outputText);count++
}}}
await emit(join(root,'server'));await emit(join(root,'src/drawing'))
for(const file of ['docs/AI_DRAWING_GUIDE.md','docs/DRAWING_STANDARD.md'])await access(join(root,file))
console.error(`FlyMind package: ${count} precompiled modules; drawing standards present. prepack separately checks the UI bundle.`)
