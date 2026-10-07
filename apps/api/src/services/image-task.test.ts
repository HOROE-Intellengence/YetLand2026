import { expect, it, vi } from 'vitest';
import { waitForImageTask } from './image-task';
it('polls an accepted async task without resubmitting and accepts its normal image result', async () => {
  const fetcher = vi.fn(async () => Response.json({ created: 1, data: [{ url: 'https://storage.example/image.png' }] }));
  const result = await waitForImageTask({ object: 'image.task', status: 'queued', poll_url: '/v1/images/tasks/one' }, new URL('https://images.example/v1'), 'test-key', AbortSignal.timeout(10000), fetcher);
  expect(result.data).toEqual([{ url: 'https://storage.example/image.png' }]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe('https://images.example/v1/images/tasks/one');
  expect(init.method).toBeUndefined();
  expect(init.body).toBeUndefined();
});
it('never forwards provider credentials to an external task URL', async () => {
  const fetcher = vi.fn();
  await expect(waitForImageTask({ object: 'image.task', status: 'queued', poll_url: 'https://evil.example/v1/images/tasks/one' }, new URL('https://images.example/v1'), 'test-key', AbortSignal.timeout(10000), fetcher)).rejects.toThrow('IMAGE_TASK_URL_REJECTED');
  expect(fetcher).not.toHaveBeenCalled();
});
it('recognizes terminal failure without polling or re-generating', async () => {
  const fetcher = vi.fn();
  await expect(waitForImageTask({ object: 'image.task', status: 'failed', poll_url: '/v1/images/tasks/one' }, new URL('https://images.example/v1'), 'test-key', AbortSignal.timeout(10000), fetcher)).rejects.toThrow('IMAGE_TASK_FAILED');
  expect(fetcher).not.toHaveBeenCalled();
});
