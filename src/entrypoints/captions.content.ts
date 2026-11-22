import { defineContentScript } from 'wxt/utils/define-content-script';
import { installVideoCaptions } from '@/content/captions-feature';

/**
 * Video caption translator (YouTube / X / HTML5). Injected on demand only when caption
 * translation is enabled on a supported host, keeping subtitle parsers out of normal tabs.
 */
export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_idle',
  main: installVideoCaptions,
});
