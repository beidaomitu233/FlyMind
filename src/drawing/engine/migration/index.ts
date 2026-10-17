export * from './types'
export {previewLegacySwimlane,convertLegacySwimlane} from './legacy-swimlane'
export {previewLegacyGeneric,convertLegacyGeneric}from'./legacy-generic'
import {previewLegacySwimlane,convertLegacySwimlane}from'./legacy-swimlane'
import {previewLegacyGeneric,convertLegacyGeneric}from'./legacy-generic'
import type{LegacyMigrationOptions,LegacyMigrationConvertOptions}from'./types'
const kind=(input:unknown)=>{const source=input as {kind?:unknown;content?:{kind?:unknown}}|null;return source?.content?.kind??source?.kind}
export function previewLegacyMigration(input:unknown,options?:LegacyMigrationOptions){return kind(input)==='swimlane'?previewLegacySwimlane(input,options):previewLegacyGeneric(input,options)}
export function convertLegacyMigration(input:unknown,options:LegacyMigrationConvertOptions){return kind(input)==='swimlane'?convertLegacySwimlane(input,options):convertLegacyGeneric(input,options)}
