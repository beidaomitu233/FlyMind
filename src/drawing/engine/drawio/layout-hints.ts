export interface NativeLayoutHints {
 nodes?:Record<string,{width:number;height:number;font:number;shape:string}>
 ranks?:Record<string,number>
 groupColumns?:Record<string,number>
 architectureTopHeaders?:Record<string,number>
 phaseSizes?:Record<string,number>
}
