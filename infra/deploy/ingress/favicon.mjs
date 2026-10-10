export const faviconPath = '/yetland-favicon-gold-v1.svg';
export const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="12" fill="#090b0d"/><path d="M10 12l10 12 10-12M20 24v8" fill="none" stroke="#B08D45" stroke-width="3"/></svg>`;

export function withFavicon(response) {
  if (response.status !== 200 || !response.headers.get('content-type')?.toLowerCase().includes('text/html')) return response;
  response.headers.delete('content-length');
  response.headers.delete('etag');
  return new HTMLRewriter()
    .on('link', { element(element) {
      const rel = (element.getAttribute('rel') || '').toLowerCase().split(/\s+/);
      if (rel.includes('icon')) element.remove();
    } })
    .on('head', { element(element) {
      element.append(`<link rel="icon" type="image/svg+xml" href="${faviconPath}">`, { html: true });
    } })
    .transform(response);
}
