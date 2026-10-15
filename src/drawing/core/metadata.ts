import type {DiagramDocument} from './model'
// Dates belong to document metadata, never to AI-authored content/rendering.
export function byCreationNewest(a:Pick<DiagramDocument,'id'|'createdAt'>,b:Pick<DiagramDocument,'id'|'createdAt'>){return (b.createdAt||0)-(a.createdAt||0)||a.id.localeCompare(b.id)}
export function byModifiedNewest(a:Pick<DiagramDocument,'id'|'createdAt'|'updatedAt'>,b:Pick<DiagramDocument,'id'|'createdAt'|'updatedAt'>){return (b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)||byCreationNewest(a,b)}
