/* Ludora — dev/build-single.mjs
   Bundles the whole app into one self-contained HTML file (ludora.html):
   CSS + all scripts inlined, no external requests. Used for the in-app
   preview and for share-as-one-file builds. The multi-file build remains
   the deployable PWA. */
import { readFile, writeFile } from 'fs/promises';

const read = (p) => readFile(p, 'utf8');

let html = await read('index.html');

/* inline stylesheet */
const css = await read('css/app.css');
html = html.replace('<link rel="stylesheet" href="css/app.css">', '<style>\n' + css + '\n</style>');

/* drop external resource links (they cannot load and would log errors) */
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '');
html = html.replace(/<link rel="(icon|apple-touch-icon)"[^>]*>\n?/g, '');

/* inline scripts in order */
const scripts = [
  'js/engine.js', 'js/ai.js', 'js/persist.js', 'js/store.js', 'js/profile.js',
  'js/audio.js', 'js/board.js', 'js/net.js', 'js/mp.js', 'js/qr.js',
  'js/ads.js', 'js/game.js', 'js/ui.js', 'js/main.js'
];
for (const s of scripts) {
  const code = await read(s);
  html = html.replace('<script src="' + s + '" defer></script>',
    '<script>\n' + code + '\n</script>');
}

html = html.replace('<title>Ludora · Premium Ludo</title>',
  '<title>Ludora · Premium Ludo (single-file build)</title>');

await writeFile('ludora.html', html);
console.log('wrote ludora.html —', (html.length / 1024).toFixed(1), 'KB');
