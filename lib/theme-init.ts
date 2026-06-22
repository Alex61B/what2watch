// lib/theme-init.ts
// Single source of truth for the inline theme bootstrap script. Imported by app/layout.tsx
// (which renders it) and lib/security-headers.ts (which hashes it for the CSP script-src), so the
// CSP sha256 always matches the exact bytes that are served — no hash drift (research §4).
//
// Runs before paint so the right theme class is on <html> immediately — no flash of the wrong
// theme on load. Defaults to LIGHT (the editorial PikFlix look); the `dark` class is only added
// when the visitor has explicitly chosen dark before.
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem('w2w_theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`
