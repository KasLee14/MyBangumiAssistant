import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({
  configFile: new URL('./vite.config.ts', import.meta.url).pathname.replace(/^\//, ''),
  root: new URL('../web', import.meta.url).pathname.replace(/^\//, ''),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const mod = await server.ssrLoadModule('/src/components/content/index.tsx');
  const html = renderToStaticMarkup(createElement(mod.ContentBlock, { block: { type: 'Callout', props: {}, pending: true } }));
  console.log('SSR_OK', html.length, html.slice(0, 90));
  const registry = await server.ssrLoadModule('/src/components/content/registry.tsx');
  console.log('KINDS', registry.CONTENT_KINDS.join(','));
} catch (error) {
  console.log('SSR_FAIL', error && error.message);
} finally {
  await server.close();
}
