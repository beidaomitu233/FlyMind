// Shared measurement keeps the pure layout and SVG renderer in agreement.
export function textUnits(value:string){return [...value].reduce((sum,c)=>sum+(/[\u0000-\u00ff]/.test(c)?.58:1),0)}
export function wrapText(text:string,max:number):string[]{
  const lines:string[]=[]
  for(const part of text.split('\n')){let line='',length=0;for(const char of part){const w=textUnits(char);if(length+w>max&&line&&!/[，。！？、：；）】》〉!?;:,.]/.test(char)){lines.push(line);line='';length=0}line+=char;length+=w}lines.push(line)}
  return lines
}
