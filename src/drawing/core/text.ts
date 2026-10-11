// Shared measurement keeps the pure layout and SVG renderer in agreement.
export function wrapText(text:string,max:number):string[]{
  const lines:string[]=[]
  for(const part of text.split('\n')){let line='',length=0;for(const char of part){const w=/[\u0000-\u00ff]/.test(char)?.58:1;if(length+w>max&&line){lines.push(line);line='';length=0}line+=char;length+=w}lines.push(line)}
  return lines
}
