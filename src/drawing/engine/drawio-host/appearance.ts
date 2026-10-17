export type DrawioAppearance='light'|'dark'
const STYLE_ID='flymind-editor-appearance'

/** UI chrome only. Never enable native graph dark-mode or touch model/SVG cells. */
const UI_CSS=`
:root[data-flymind-appearance]{color-scheme:light!important;--fm-panel:#fff;--fm-sidebar:#fafafa;--fm-workspace:#f5f6fa;--fm-popup:#fff;--fm-field:#fff;--fm-hover:#f0f1f5;--fm-line:#e5e7eb;--fm-text:#35383f;--fm-muted:#858993;--fm-accent:#7168da;--fm-selected:#eeecff;--fm-shadow:0 8px 24px #00000012;
--ge-panel-color:var(--fm-panel);--toolbar-color:var(--fm-panel);--workspace-color:var(--fm-workspace);--inactive-color:var(--fm-sidebar);--active-color:var(--fm-hover);--primary-color:var(--fm-selected);--primary-hover-color:var(--fm-hover);--accent-color:var(--fm-selected);--accent-hover-color:var(--fm-hover);--accent-text-color:var(--fm-accent);--border-color:var(--fm-line);--highlight-color:var(--fm-hover);--text-color:var(--fm-text);--dialog-color:var(--fm-popup);--strong-text-color:var(--fm-text);--secondary-text-color:var(--fm-muted);--field-color:var(--fm-field);--field-border-color:var(--fm-line);--strong-border-color:var(--fm-line);--card-color:var(--fm-popup);--soft-color:var(--fm-hover);--soft-hover-color:var(--fm-hover);--focus-color:var(--fm-accent);--selected-color:var(--fm-selected);--selected-hover-color:var(--fm-selected);--active-item-color:var(--fm-hover);--scrollbar-color:var(--fm-line);--scrollbar-hover-color:var(--fm-muted)}
:root[data-flymind-appearance="dark"]{--fm-panel:#212121;--fm-sidebar:#191919;--fm-workspace:#212121;--fm-popup:#2b2b2b;--fm-field:#212121;--fm-hover:#343434;--fm-line:#3a3a3a;--fm-text:#e1e1e1;--fm-muted:#a1a1a1;--fm-accent:#8b83ff;--fm-selected:#373345;--fm-shadow:0 8px 24px #00000035}
:root[data-flymind-appearance] .geEditor{color-scheme:light!important;background:var(--fm-workspace)!important;color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.geMenubarContainer,.geToolbarContainer,.geTabContainer,.geButtonContainer,.geFooterContainer,.geFormatTitleContainer){background:var(--fm-panel)!important;background-image:none!important;border-color:var(--fm-line)!important;box-shadow:none!important;color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.geSidebarContainer,.geFormatContainer){background:var(--fm-sidebar)!important;border-color:var(--fm-line)!important;color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.mxWindow,.mxPopupMenu,.geDialog,.geSidebarTooltip){background:var(--fm-popup)!important;background-image:none!important;border:1px solid var(--fm-line)!important;border-radius:8px;box-shadow:var(--fm-shadow)!important;color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.mxWindowTitle,.mxWindowPane,.geDialogTitle,.geDialogFooter,.geSidebarTitle){background:var(--fm-popup)!important;background-image:none!important;border-color:var(--fm-line)!important;color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.geButton,.geTitle,.geLabel,.geTabItem,.mxPopupMenuItem,.geFormatTitle){color:var(--fm-text)!important;border-color:var(--fm-line)!important;text-shadow:none!important}
:root[data-flymind-appearance] :is(.geBtn,.gePrimaryBtn,.geToolbarContainer button,.geMenubarContainer button){background:var(--fm-field)!important;background-image:none!important;border:1px solid var(--fm-line)!important;border-radius:5px;box-shadow:none!important;color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.geButton,.geBtn,.geTabItem):hover,:root[data-flymind-appearance] tr.mxPopupMenuItemHover{background-color:var(--fm-hover)!important;box-shadow:none!important}
:root[data-flymind-appearance] :is(.geActiveTab,.geTabItem.geActiveTab,.geActiveFormatTitle,.gePrimaryBtn){background:var(--fm-selected)!important;color:var(--fm-accent)!important}
:root[data-flymind-appearance] :is(.geDialog,.mxWindow,.geSidebarContainer,.geToolbarContainer,.mxPopupMenu) :is(input,select,textarea):not(.mxCellEditor *){background-color:var(--fm-field)!important;color:var(--fm-text)!important;border-color:var(--fm-line)!important;accent-color:var(--fm-accent);box-shadow:none!important}
:root[data-flymind-appearance] :is(.geDialog,.mxWindow,.geSidebarContainer) :is(input,select,textarea):focus{outline:1px solid var(--fm-accent);outline-offset:1px}
:root[data-flymind-appearance] :is(.mxPopupMenu,.mxWindow) hr{border-color:var(--fm-line)!important}
:root[data-flymind-appearance] :is(.geMenubarContainer,.geToolbarContainer,.geTabContainer,.mxPopupMenu) a{color:var(--fm-text)!important}
:root[data-flymind-appearance] :is(.geSidebarContainer,.mxWindowPane,.geFormatContainer){scrollbar-color:var(--fm-line) transparent;scrollbar-width:thin}
/* Keep document paper, native grid visibility and all diagram colors intact. */
:root[data-flymind-appearance] .geDiagramContainer{color-scheme:light!important;background-color:#fff!important}
:root[data-flymind-appearance] .geDiagramContainer:has(.geBackgroundPage){background-color:var(--fm-workspace)!important}
/* Dark editor environment only: mix the native transparent grid background,
 * not any SVG drawing node. Native grid image/position/zoom/on-off stay owned by draw.io. */
:root[data-flymind-appearance="dark"] .geDiagramContainer,:root[data-flymind-appearance="dark"] .geDiagramContainer:has(.geBackgroundPage){background-color:#171717!important}
:root[data-flymind-appearance="dark"] .geDiagramContainer:not(:has(.geBackgroundPage))>svg{background-color:#171717!important;background-blend-mode:soft-light!important}
/* Remove only the footer project shortcut; retain its right-side spacing. */
:root[data-flymind-appearance] .geTabContainer>a[href="https://github.com/jgraph/drawio"]{display:none!important}
:root[data-flymind-appearance] .geTabContainer>.geZoomInput{margin-left:auto!important}
/* Page tabs and zoom are UI chrome, not graph content. */
:root[data-flymind-appearance] .geTabContainer .geTab.gePageTab.geActivePage{background:var(--fm-selected)!important;color:var(--fm-accent)!important;box-shadow:none!important}
:root[data-flymind-appearance] .geTabContainer .geTab.gePageTab.geActivePage>span{color:var(--fm-accent)!important}
:root[data-flymind-appearance="dark"] .geTabContainer .geTab>div.geButton:empty{filter:invert(.85);background-color:transparent!important}
:root[data-flymind-appearance="dark"] .geTabContainer input.geZoomInput{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23c9c9c9' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")!important;background-repeat:no-repeat!important;background-position:right 5px center!important;background-size:10px 6px!important;color:var(--fm-text)!important}
/* Only monochrome UI icons, never diagram SVG, palette previews or cell editor. */
:root[data-flymind-appearance="dark"] .geMenubarContainer .geButton:empty:not(.geColorBtn,[style*="background-color"]),:root[data-flymind-appearance="dark"] :is(.mxWindowTitle,.mxPopupMenuIcon)>img,:root[data-flymind-appearance="dark"] .mxPopupMenuItem[style*="text-align: right"]>div[style*="background-image"]{filter:invert(.85);background-color:transparent!important}
`

export function applyDrawioAppearance(document:Document,appearance:DrawioAppearance='light'){
 document.documentElement.setAttribute('data-flymind-appearance',appearance==='dark'?'dark':'light')
 let style=document.getElementById(STYLE_ID)
 if(!style){style=document.createElement('style');style.id=STYLE_ID;style.textContent=UI_CSS;document.head.appendChild(style)}
}
