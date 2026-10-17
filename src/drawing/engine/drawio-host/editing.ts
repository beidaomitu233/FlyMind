/** Fixed 31.5.3 DOM adapter for unload risk only. Never reads graph or edits DOM. */
export function hasUncommittedNativeText(readDocument:()=>Document|null):boolean{
  try{
    const document=readDocument();if(!document)return true
    for(const editor of document.querySelectorAll<HTMLElement>('.mxCellEditor')){
      const view=document.defaultView;if(!view)return true
      const style=view.getComputedStyle(editor)
      // Open editor means potentially uncommitted, even if its text is unchanged.
      if(editor.isConnected&&style.display!=='none'&&style.visibility!=='hidden'&&editor.getClientRects().length>0)return true
    }
    return false
  }catch{return true}
}
