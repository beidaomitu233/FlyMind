const pad=(value:number,size=2)=>String(value).padStart(size,'0')
export function exportStamp(at:number){const d=new Date(at);return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(),3)}`}
export function exportBasename(title:string,at:number){return (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'图形')+'_'+exportStamp(at)}
