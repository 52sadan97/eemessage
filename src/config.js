export const API_URL = import.meta.env.VITE_API_URL || 'https://eemessage.sdnnet.com.tr';

export const getMediaUrl = (url) => {
  if (!url) return url;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url}`;
};
