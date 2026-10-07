// Komposisi overlay untuk preview = komposisi yang sama dengan export cepat (toOverlayTemplate + data proyek),
// dengan aset dari reel://vendor dan file proyek dari reel://project. Waktu dikendalikan player lewat postMessage.
import { renderTemplate, type CompositionData } from '../../../core/compose';
import { toOverlayTemplate, VENDOR_DIR } from '../../../core/overlay';

// Runtime kecil pengganti runtime HyperFrames: timeline GSAP di-seek ke waktu edit, klip (b-roll) tampil sesuai data-start
const RUNTIME = `<script>
(function () {
  function clips(t) {
    document.querySelectorAll('.clip[data-start]').forEach(function (el) {
      var s = parseFloat(el.dataset.start), d = parseFloat(el.dataset.duration);
      var on = t >= s && t < s + d;
      el.style.visibility = on ? 'visible' : 'hidden';
      if (el.tagName === 'VIDEO' && on && Math.abs(el.currentTime - (t - s)) > 0.25) el.currentTime = t - s;
    });
  }
  function seek(t) {
    var tl = window.__timelines && window.__timelines.main;
    if (tl) tl.time(Math.max(0, t), false);
    clips(t);
  }
  window.addEventListener('message', function (e) { if (e.data && typeof e.data.t === 'number') seek(e.data.t); });
  seek(0);
  parent.postMessage({ previewReady: true }, '*');
})();
</script>`;

export function previewHtml(tpl: string, fontCss: string, data: CompositionData, overlay: { css?: string; html?: string; js?: string }): string {
  let html = renderTemplate(toOverlayTemplate(tpl, fontCss), data, overlay);
  html = html.split(`${VENDOR_DIR}/`).join('reel://vendor/');
  html = html.replace('<head>', '<head>\n    <base href="reel://project/" />\n    <script>window.__timelines = {};</script>');
  // latar tetap transparan di iframe
  html = html.replace('</head>', '    <style>html,body{background:transparent!important}</style>\n  </head>');
  return html.replace('</body>', `${RUNTIME}\n  </body>`);
}
