/** Fixed local upstream routing supply; no CDN or dependency replacement. */
export const ROUTING_SUPPLY={
 'libavoid.min.js':'1c963a8f53b464a87c2fba3dc304a720d924fdcda4737cfd950e33f6a4c41c1d',
 'libavoid-routing.js':'9327d57d3c4f3fa04fc1eeb91d7da045c2b1a2ba87df681e029145d3ee2f04b6',
 'LICENSE':'6da7ddf40cfea6f568961825b14478e879875f6ad033fad57889ae5bd52103f4',
} as const
export interface RoutingSupply {Avoid:any;core:{computeRoutes:(avoid:any,vertices:any[],edges:any[],options?:any)=>Record<string,Array<{x:number;y:number}>>}}
