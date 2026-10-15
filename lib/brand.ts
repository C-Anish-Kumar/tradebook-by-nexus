// One place for the product's name and public links

export const BRAND_NAME = 'Tradebook';
export const BRAND_FULL = 'Tradebook by Nexus';

// Used in emails, where links must be absolute
export const APP_URL = (process.env.BETTER_AUTH_URL || 'https://open-stock-nexus.vercel.app').replace(/\/+$/, '');

// Shown on Help and Terms when set; the links hide otherwise
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || '';

// Tradebook is built on OpenStock (AGPL-3.0); the license asks us to credit it and offer our source
export const UPSTREAM_NAME = 'OpenStock by Open Dev Society';
export const UPSTREAM_URL = 'https://github.com/Open-Dev-Society/OpenStock';
