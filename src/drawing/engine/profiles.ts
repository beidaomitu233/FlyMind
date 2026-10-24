import type {DiagramKind} from '../core/model'
import type {RenderingProfile,DrawioCapabilities,DrawioKindCapabilities} from './types'
import {DRAWIO_VERSION,DRAWIO_ADAPTER_VERSION,DEFAULT_SWIMLANE_PROFILE} from './constants'

/** Profile names are stable identities, not promises of implemented capabilities. */
const profiles:Record<DiagramKind,RenderingProfile>={
 swimlane:DEFAULT_SWIMLANE_PROFILE,
 flowchart:{id:'flowchart-standard',version:'1'},
 architecture:{id:'architecture-standard',version:'1'},
 mindmap:{id:'mindmap-standard',version:'1'},
 dataflow:{id:'dataflow-standard',version:'1'},
 technical:{id:'technical-standard',version:'1'},
}
export function defaultProfileForKind(kind:DiagramKind):RenderingProfile {
 if(!Object.hasOwn(profiles,kind))throw new Error('UNSUPPORTED_DIAGRAM_KIND');return {...profiles[kind]}
}
export function kindForProfile(profile:RenderingProfile):DiagramKind {
 const kind=(Object.keys(profiles) as DiagramKind[]).find(kind=>profiles[kind].id===profile.id&&profiles[kind].version===profile.version);if(!kind)throw new Error('UNSUPPORTED_PROFILE');return kind
}
/** Enable only after that batch has real compile/project/edit/export evidence. */
export function drawioCapabilities():DrawioCapabilities {
 const matrix=(Object.keys(profiles) as DiagramKind[]).map((kind):DrawioKindCapabilities=>({kind,profile:defaultProfileForKind(kind),compile:true,project:true,patch:true,configureRendering:true,migrateLegacy:kind==='swimlane',orientations:['vertical','horizontal']}))
 return {engineVersion:DRAWIO_VERSION,adapterVersion:DRAWIO_ADAPTER_VERSION,supportedKinds:matrix.filter(p=>p.compile&&p.project&&p.patch).map(p=>p.kind),profiles:matrix}
}
