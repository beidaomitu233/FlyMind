const MiB=1024*1024

/** Server operator opt-in; unknown values retain the stricter default. */
export function resolveMemoryProfile(name:string|undefined){
 return name==='compact-1g'
  ?{browserAdmissionBytes:384*MiB,svgAdmissionBytes:384*MiB,svgRssBytes:256*MiB,svgHeapMiB:160}
  :{browserAdmissionBytes:512*MiB,svgAdmissionBytes:512*MiB,svgRssBytes:384*MiB,svgHeapMiB:256}
}

/** Capture once from the service environment, not request parameters. */
export const HEAVY_MEMORY_PROFILE=Object.freeze(resolveMemoryProfile(process.env.FLYMIND_MEMORY_PROFILE))
