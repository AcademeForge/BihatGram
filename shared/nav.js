/* ═══════════════════════════════════════════════════
   BIHATGRAM — NAV
   Renders the shared header ("BihatGram") and the bottom
   navigation bar (Home / Search / Chats / Profile / Settings)
   with SVG icons, and highlights whichever tab is active
   on the current page.

   Usage: include this script on every page AFTER core.js,
   and call `nxRenderNav('home')` (or 'search' | 'chats' |
   'profile' | 'settings') once the DOM is ready, passing the
   id of the container element where the bottom nav should
   be injected and, optionally, a header container id.
═══════════════════════════════════════════════════ */

const NAV_ITEMS = [
  {
    key: 'home',
    label: 'Home',
    href: 'home.html',
    icon: `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9"/></svg>`
  },
  {
    key: 'search',
    label: 'Search',
    href: 'search.html',
    icon: `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/></svg>`
  },
  {
    key: 'chats',
    label: 'Chats',
    href: 'chat.html',
    icon: `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`
  },
  {
    key: 'profile',
    label: 'Profile',
    href: 'profile.html',
    icon: `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 19.6a7.2 7.2 0 0 1 14.4 0"/></svg>`
  },
  {
    key: 'settings',
    label: 'Settings',
    href: 'settings.html',
    icon: `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.97 7.97 0 0 0 0-2l2-1.6-2-3.4-2.4.9a8 8 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a8 8 0 0 0-1.7 1l-2.4-.9-2 3.4 2 1.6a7.97 7.97 0 0 0 0 2l-2 1.6 2 3.4 2.4-.9a8 8 0 0 0 1.7 1l.4 2.5h4l.4-2.5a8 8 0 0 0 1.7-1l2.4.9 2-3.4-2-1.6z"/></svg>`
  }
];

/**
 * Renders the bottom navigation bar into the element with id `navContainerId`,
 * marking the item whose key === activeKey as active. Each item is a real
 * <a href> link so the pages work as a true multi-file site (no client-side
 * router needed) while still degrading gracefully if scripts are disabled.
 */
function nxRenderNav(activeKey, navContainerId = 'bnav'){
  const el = document.getElementById(navContainerId);
  if(!el) return;
  el.innerHTML = NAV_ITEMS.map(item => {
    const isActive = item.key === activeKey;
    return `<a class="af-nav-btn${isActive ? ' active' : ''}" href="${item.href}" aria-label="${item.label}"${isActive ? ' aria-current="page"' : ''}>
      <span class="af-nav-icon-wrap">${item.icon}</span>
      <span class="af-nav-label">${item.label}</span>
    </a>`;
  }).join('');
}

/**
 * Renders the shared "BihatGram" header bar into the element with id
 * `headerContainerId`. `rightSlotHtml` lets each page inject its own
 * header-right controls (e.g. avatar button, search-full button, menu)
 * while keeping the brand title identical everywhere.
 */
function nxRenderHeader(headerContainerId = 'hdr', rightSlotHtml = '', titleOverride = ''){
  const el = document.getElementById(headerContainerId);
  if(!el) return;
  el.innerHTML = `<div class="af-topbar-flex">
    <div class="af-topbar-headline">${titleOverride || 'BihatGram'}</div>
    <div style="display:flex;align-items:center;gap:8px;">${rightSlotHtml}</div>
  </div>`;
}

window.nxRenderNav = nxRenderNav;
window.nxRenderHeader = nxRenderHeader;
window.NAV_ITEMS = NAV_ITEMS;
