import type {DiagramDocument} from './model'
// Dates belong to document metadata, never to AI-authored content/rendering.
export function byCreationNewest(a:Pick<DiagramDocument,'id'|'createdAt'>,b:Pick<DiagramDocument,'id'|'createdAt'>){return (b.createdAt||0)-(a.createdAt||0)||a.id.localeCompare(b.id)}
