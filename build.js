/* Bundles the app into one self-contained HTML file (dist/RAL-Browser.html) that opens by double-click. */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let css = read('css/styles.css').replace(/url\(\.\.\/vendor\/fonts\/([^)]+\.woff2)\)/g, (_, f) =>
  `url(data:font/woff2;base64,${fs.readFileSync(path.join(root, 'vendor/fonts', f)).toString('base64')})`);

// Keep "</script>"/"</style>" sequences inside inlined code from closing the tag early.
const safe = (s, tag) => s.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="css\/styles\.css">/, () => `<style>\n${safe(css, 'style')}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => `<script>\n${safe(read(src), 'script')}\n</script>`);
html = html.replace('<script>', '<script>window.RAL_STANDALONE = true;</script>\n<script>');

const licenses = ['vendor/js-yaml.LICENSE', 'vendor/fonts/IBM-Plex-Mono.LICENSE'].filter((p) => fs.existsSync(path.join(root, p)));
const notice = `<!--\n  RAL Browser - standalone build ${new Date().toISOString().slice(0, 10)}\n  Bundles js-yaml (MIT) and IBM Plex Mono (SIL OFL 1.1); see the licences below.\n\n${licenses
  .map((p) => `== ${p} ==\n${read(p).replace(/--/g, '- -')}`).join('\n\n')}\n-->\n`;
html = html.replace(/<!doctype html>/i, (m) => `${m}\n${notice}`);

if (/(?:src|href)="(?!data:|#|https?:)[^"]+\.(?:js|css)"/.test(html)) throw new Error('Unbundled asset reference left in output');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'RAL-Browser.html');
fs.writeFileSync(out, html);
// index.html is what GitHub Pages serves at the site root.
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log(`Wrote ${path.relative(root, out)} (${(html.length / 1024).toFixed(0)} KB)`);
