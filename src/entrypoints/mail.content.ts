import { defineContentScript } from 'wxt/utils/define-content-script';
import { installMailBanners } from '@/content/mail-feature';

/**
 * Gmail/Outlook banner. Registered at runtime only for granted mail origins or loaded on
 * demand from `content.js`, keeping mail banner code out of ordinary web tabs.
 */
export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_idle',
  main: installMailBanners,
});
