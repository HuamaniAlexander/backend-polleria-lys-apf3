// Infrastructure only. The private API key must never use the VITE_ prefix.
import { getInsforgeAdminConfig } from './insforge-admin-config.mjs';
const { baseUrl, headers } = getInsforgeAdminConfig();
const appUrl = process.env.APP_URL || 'http://localhost:5173';
const endpoint = `${baseUrl}/api/auth/config`;
const currentResponse = await fetch(endpoint, { headers, redirect: 'error' });
if (!currentResponse.ok) throw new Error(`No se pudo leer Auth: HTTP ${currentResponse.status}`);
const current = await currentResponse.json();
const allowedRedirectUrls = [...new Set([...(current.allowedRedirectUrls || []), ...['/auth/callback','/login','/reset-password','/verify-email'].map(path => new URL(path, appUrl).href)])];
const response = await fetch(endpoint, { method: 'PUT', headers, redirect: 'error', body: JSON.stringify({
  passwordMinLength: 8, requireNumber: true, verifyEmailMethod: 'code', resetPasswordMethod: 'code', allowedRedirectUrls,
}) });
if (!response.ok) throw new Error(`No se pudo configurar Auth: HTTP ${response.status}`);
console.log('Auth configurado: minimo 8 caracteres, numero, verificacion y recuperacion por codigo, redirects permitidos.');
