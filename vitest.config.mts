import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // The independently imported phone app uses Next's @/ alias. Preserve the
  // default repository-wide test discovery while resolving its real modules.
  resolve: { alias: { '@': fileURLToPath(new URL('./ai-virtual-phone', import.meta.url)) } },
});
