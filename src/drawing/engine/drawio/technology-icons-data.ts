import {technologyBrandIcons} from '../technology-brand-icons'
/** Fixed CC0 Simple Icons commit and license live in resources/technology-icons. */
export const TECHNOLOGY_ICONS:Record<string,{svg:string;color:string}>=Object.fromEntries(Object.entries(technologyBrandIcons).map(([slug,svg])=>[slug,{svg:svg.replace(/fill="#[a-fA-F0-9]{3,8}"/g,'fill="#0ea5e9"'),color:'#0ea5e9'}]))
for(const [alias,slug]of Object.entries({vue:'vuedotjs',node:'nodedotjs',nodejs:'nodedotjs','spring-boot':'springboot',postgres:'postgresql'}))TECHNOLOGY_ICONS[alias]=TECHNOLOGY_ICONS[slug]
// FlyMind-authored generic symbols, not approximations of unsupplied trademarks.
const symbol=(body:string)=>({svg:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0ea5e9" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,color:'#0ea5e9'})
Object.assign(TECHNOLOGY_ICONS,{
 desktop:symbol('<rect x="2" y="3" width="20" height="14" rx="1"/><path d="M8 21h8M12 17v4M2 14h20"/>'),
 mobile:symbol('<rect x="6" y="1" width="12" height="22" rx="2"/><path d="M10 4h4M11 20h2"/>'),
 quartz:symbol('<circle cx="12" cy="12" r="10"/><path d="M12 5v7l5 4"/>'),
 'redis-stream':symbol('<path d="M5 17H4a3 3 0 0 1 0-6 5 5 0 0 1 10-4 4 4 0 0 1 5 4 3 3 0 0 1 1 6h-1"/><path d="M8 9v10M16 9v10M8 12h8M8 16h8"/><circle cx="8" cy="10" r="1"/><circle cx="16" cy="18" r="1"/>'),
 redisson:symbol('<rect x="3" y="10" width="18" height="12" rx="1"/><path d="M7 10V7a5 5 0 0 1 10 0v3M12 15v3"/>'),
 uniapp:symbol('<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>'),
 portainer:symbol('<path d="M3 5h18M12 2v20M5 5 1 15h8zM19 5l-4 10h8zM7 22h10"/>'),
 'spring-boot-admin':symbol('<rect x="2" y="3" width="20" height="15"/><path d="M7 22h10M12 18v4M5 12l4-4 4 3h6"/>'),
 druid:symbol('<ellipse cx="12" cy="4" rx="9" ry="3"/><path d="M3 4v16c0 4 18 4 18 0V4M3 10c0 4 18 4 18 0M3 15c0 4 18 4 18 0"/>'),
 skywalking:symbol('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="2" r="1.5"/><circle cx="3" cy="17" r="1.5"/><circle cx="21" cy="17" r="1.5"/><path d="M12 4v5M9 14l-4 2M15 14l4 2M3 7l6 3M21 7l-6 3M12 15v7"/>'),
})
