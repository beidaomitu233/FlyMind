import {drawioCapabilities} from '../engine/profiles'
export const MAX_IMPORT_SOURCE_BYTES=2_500_000
export const MAX_NATIVE_REQUEST_BYTES=4_000_000
export const MAX_NATIVE_XML_BYTES=4_000_000
/** Browser/Runtime/MCP consume the same actual engine matrix and transport limits. */
export function nativeDocumentCapabilities(){const engine=drawioCapabilities();return {...engine,configureRendering:engine.profiles.some(p=>p.configureRendering),imports:{contentJSON:true,businessProjectJSON:true,drawio:false,canvasOnly:false,maxSourceBytes:MAX_IMPORT_SOURCE_BYTES,maxRequestBytes:MAX_NATIVE_REQUEST_BYTES,maxXMLBytes:MAX_NATIVE_XML_BYTES}}}
