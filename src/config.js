// If accessed via domain (port 80/443) → same origin (reverse proxy handles routing)
// If accessed via direct port (e.g. localhost:7010) → use hostname:3010
const port = window.location.port;
const isProxied = !port || port === '80' || port === '443';
export const API_URL = import.meta.env.VITE_API_URL || (isProxied 
  ? `${window.location.protocol}//${window.location.hostname}` 
  : `${window.location.protocol}//${window.location.hostname}:3010`);

export const getMediaUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url}`;
};
