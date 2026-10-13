import type { SelectionFragment } from '../core/clipboard'
import { parseFragment } from '../core/clipboard'

const KEY='flymind-selection-clipboard-v1'
let memory=''
export function rememberFragment(fragment:SelectionFragment){memory=JSON.stringify(fragment);try{localStorage.setItem(KEY,memory);return true}catch{return false}}
export async function writeFragment(fragment:SelectionFragment){const saved=rememberFragment(fragment);try{await navigator.clipboard.writeText(JSON.stringify(fragment));return true}catch{return saved}}
export async function readFragment(){
  let text:string|undefined
  try{text=await navigator.clipboard.readText()}catch{}
  // An accessible non-FlyMind clipboard must never silently paste stale nodes.
  if(text!==undefined&&text.trim())return parseFragment(text)
  const cached=memory||localStorage.getItem(KEY)||'';if(!cached)throw new Error('剪贴板没有节点片段')
  return parseFragment(cached)
}
