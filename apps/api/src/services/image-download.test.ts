import { describe, it, expect } from 'vitest';
import { publicImageAddress, readImageResponse } from './image-download';
describe('provider image downloads', () => {
  it('rejects loopback, private, link-local, Fake-IP and mapped IPv6', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '198.18.0.1', '100.64.0.1']) expect(publicImageAddress(ip, 4)).toBe(false);
    for (const ip of ['::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) expect(publicImageAddress(ip, 6)).toBe(false);
    expect(publicImageAddress('104.18.0.100', 4)).toBe(true);
  });
  it('bounds streamed bodies even without a Content-Length header', async () => {
    await expect(readImageResponse(new Response('too large'), 3)).rejects.toThrow('IMAGE_RESPONSE_TOO_LARGE');
    await expect(readImageResponse(new Response('bad', { status: 404 }))).rejects.toThrow('IMAGE_DOWNLOAD_HTTP_404');
  });
});
