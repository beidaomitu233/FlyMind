import Database from 'better-sqlite3'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {StoreError} from '../store'
import type {MigrationSource} from './types'
export const rawHash=(s:string)=>createHash('sha256').update(s).digest('hex')
/** Does not initialize SQLite, change journal mode, run migrations, or fix source data. */
export function readMigrationSource(root:string,id:string):MigrationSource {
 const db=new Database(join(root,'flymind.sqlite'),{readonly:true,fileMustExist:true})
 try{const row=db.prepare('SELECT * FROM diagrams WHERE id=?').get(id) as any
  if(!row)throw new StoreError('迁移源不存在',404,undefined,'MIGRATION_SOURCE_NOT_FOUND')
  const document=JSON.parse(row.document)
  if(document.schemaVersion===3)throw new StoreError('迁移源已经是v3',409,row.revision,'MIGRATION_ALREADY_NATIVE')
  return {diagramId:id,revision:row.revision,rawDocument:row.document,rawDocumentSha256:rawHash(row.document),createdAt:row.created_at,updatedAt:document.updatedAt,savedAt:row.saved_at,workspaceGroupId:row.workspace_group_id,deletedAt:row.deleted_at}
 }finally{db.close()}
}
