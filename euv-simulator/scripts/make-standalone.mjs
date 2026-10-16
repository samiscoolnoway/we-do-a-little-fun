// Inlines the production build (dist/index.html + dist/assets/*) so the simulator can be shared as one file:
//   dist/standalone.html  a complete page that runs straight from disk (file://) or any static host
//   dist/artifact.html    the same page as a fragment (no doctype/html/head/body) for pages that wrap it themselves
// Runs after `vite build` (see the "build" script in package.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const indexHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');

const find = (re, what) => {
  const m = indexHtml.match(re);
  if (!m) throw new Error(`make-standalone: could not find the ${what} in dist/index.html`);
  return m[1];
};
const jsFile = find(/<script[^>]*\ssrc="\.\/(assets\/[^"]+\.js)"/, 'module script');
const cssFile = find(/<link[^>]*\shref="\.\/(assets\/[^"]+\.css)"/, 'stylesheet');
const fontLinks = [...indexHtml.matchAll(/<link[^>]*(?:fonts\.googleapis\.com|fonts\.gstatic\.com)[^>]*>/g)].map((m) => m[0].replace(/\s+/g, ' ')).join('\n');
const title = find(/<title>([^<]+)<\/title>/, 'title');

// Text placed inside <script>/<style> must not contain a closing tag or an HTML comment opener.
const js = fs
  .readFileSync(path.join(dist, jsFile), 'utf8')
  .replace(/<\/(script)/gi, '<\\/$1')
  .replace(/<!--/g, '<\\!--');
const css = fs.readFileSync(path.join(dist, cssFile), 'utf8').replace(/<\/(style)/gi, '<\\/$1');

const body = `<style>\n${css}\n</style>\n<div id="root"></div>\n<script type="module">\n${js}\n</script>\n`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<title>${title}</title>
${fontLinks}
</head>
<body>
${body}</body>
</html>
`;

const fragment = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fontLinks}
${body}`;

fs.writeFileSync(path.join(dist, 'standalone.html'), standalone);
fs.writeFileSync(path.join(dist, 'artifact.html'), fragment);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} kB`;
console.log(`standalone.html ${kb(standalone)} · artifact.html ${kb(fragment)} (js ${kb(js)}, css ${kb(css)})`);
