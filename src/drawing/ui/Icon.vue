<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]||paths.diagram"/></svg></template>
<script setup lang="ts">
withDefaults(defineProps<{name:string;size?:number}>(),{size:18})
const paths:Record<string,string>={
  sun:'M12 3V1 M12 23v-2 M3 12H1 M23 12h-2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon:'M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14z',
  'folder-plus':'M3 6h6l2 2h10v12H3z M12 11v6 M9 14h6',
  group:'M3 3h18v18H3z M7 7h5v5H7z M12 12h5v5h-5z',
  'direction-vertical':'M9 3h6v5H9z M9 16h6v5H9z M12 8v8 M10 13l2 3 2-3',
  'direction-horizontal':'M3 9h5v6H3z M16 9h5v6h-5z M8 12h8 M13 10l3 2-3 2',
  more:'M5 12h.01 M12 12h.01 M19 12h.01',files:'M4 3h11l5 5v13H4z M15 3v5h5 M8 12h8 M8 16h6',edit:'M15 4l5 5 M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15z',restore:'M3 10a9 9 0 1 1 1 8 M3 4v6h6 M12 7v5l3 2',
  diagram:'M4 4h6v6H4z M14 14h6v6h-6z M14 4h6v6h-6z M7 10v7h7 M10 7h4',
  swimlane:'M3 4h18v16H3z M3 8h18 M9 4v16 M15 4v16 M5 12h2 M11 15h2 M17 11h2',
  architecture:'M3 3h18v5H3z M3 11h8v5H3z M14 11h7v5h-7z M3 19h18 M7 8v3 M17 8v3',
  dataflow:'M3 3h5v5H3z M16 3h5v5h-5z M3 13h18v5H3z M5 8v5 M18 8v5 M18 18v4H6v-4',
  flowchart:'M9 3h6v4H9z M12 7v3 M12 10l4 3-4 3-4-3z M12 16v4 M4 19h5 M15 19h5',
  mindmap:'M8 9h8v6H8z M3 4h5 M3 20h5 M16 4h5 M16 20h5 M8 12H5V4 M5 12v8 M16 12h3V4 M19 12v8',
  plus:'M12 5v14 M5 12h14',select:'M5 3l14 9-7 2-3 7z',pan:'M8 13V7a2 2 0 0 1 4 0v6 M12 11V5a2 2 0 0 1 4 0v8 M16 11a2 2 0 0 1 4 0v6a5 5 0 0 1-5 5h-3a5 5 0 0 1-4-2l-5-6a2 2 0 0 1 3-3l2 2',
  connect:'M4 5h5v5H4z M15 15h5v5h-5z M9 7h8v8',undo:'M4 9h9a7 7 0 0 1 0 14 M8 5L4 9l4 4',redo:'M20 9h-9a7 7 0 0 0 0 14 M16 5l4 4-4 4',
  fit:'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M8 8h8v8H8z',import:'M12 3v12 M7 10l5 5 5-5 M4 15v6h16v-6',export:'M12 15V3 M7 8l5-5 5 5 M4 15v6h16v-6',
  code:'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 3l-4 18',chevron:'M6 9l6 6 6-6',close:'M5 5l14 14 M19 5L5 19',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  copy:'M8 8h13v13H8z M16 8V3H3v13h5',layout:'M3 3h6v6H3z M15 3h6v6h-6z M9 15h6v6H9z M6 9v3h12V9 M12 12v3',panel:'M3 4h18v16H3z M15 4v16',check:'M5 12l4 4L19 6',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',folder:'M3 6h6l2 2h10v12H3z',bolt:'M13 2L4 14h7l-1 8 10-12h-7z'
}
</script>
