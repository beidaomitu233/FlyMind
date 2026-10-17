/** UI preference only: never persisted in a drawing or sent to document APIs. */
export type StudioAppearance='light'|'dark'
const key='flymind-studio-appearance'
export function readStudioAppearance():StudioAppearance {
  try{return localStorage.getItem(key)==='dark'?'dark':'light'}catch{return 'light'}
}
export function persistStudioAppearance(value:StudioAppearance):void {
  try{localStorage.setItem(key,value)}catch{/* A restricted browser can still change this session's appearance. */}
}
