export const phaseLabelFontSize=24
export const phaseLabelLineHeight=phaseLabelFontSize*1.45-2

// Upright glyphs, one visible character per line; content remains unchanged.
export function stackedPhaseLabel(label:string){return [...label].filter(c=>!/\s/u.test(c)).join('\n')}
export function phaseLabelMinimumHeight(label:string){return Math.ceil(stackedPhaseLabel(label).split('\n').length*phaseLabelLineHeight+24)}
