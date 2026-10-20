/** Java/Jackson serializes Long values as decimal strings. Normalize only an
 * explicitly numeric authority field, never ids, arbitrary JSON or credentials. */
export function wirePositiveInteger(value:unknown):number{
 if(typeof value==='string'){
  if(!/^[1-9][0-9]*$/.test(value))throw new TypeError('Expected a positive safe decimal integer')
  value=Number(value)
 }
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<=0)throw new TypeError('Expected a positive safe decimal integer')
 return value
}
