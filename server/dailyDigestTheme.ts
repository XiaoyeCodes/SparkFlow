// Presentation is applied when reading a cached edition so theme changes never
// require regenerating news or changing the stored source/date/integrity hash.
export const DIGEST_THEME_REVISION = 'dark-teal-v4';
export const digestDocumentRevision = (revision: string) => `${revision}.${DIGEST_THEME_REVISION}`;

const colors: Record<string, string> = {
  '#efede7': '#081514',
  '#fcfaf6': '#0d211e', '#eef4ee': '#0d211e',
  '#f1e8d8': '#122c27', '#d8eae1': '#122c27',
  '#282622': '#e2f0ea',
  '#48443e': '#c6d8d0', '#534a3c': '#c6d8d0', '#655d51': '#bdd2c8',
  '#827563': '#a0b9ae', '#756650': '#8ddcbf',
  '#918574': '#9db6aa', '#9a896f': '#9db6aa',
  '#b9aa91': '#8faaa0', '#ad9b80': '#8faaa0', '#a9987d': '#57776a',
  '#8b7b65': '#3b6a58', '#388675': '#3b6a58',
  '#ded6c8': '#2d4940', '#c9dcd2': '#2d4940', '#e1d8ca': '#2d4940', '#e3d9c9': '#2d4940',
  '#d7cbb8': '#2d4940', '#bed4c8': '#2d4940',
  '#c8bcaa': '#35594b', '#b9d2c5': '#35594b',
  '#b57d69': '#86d5b7', '#237f6d': '#86d5b7',
  '#ba735f': '#f0998e', '#b25858': '#f0998e', '#557e6c': '#7fd8b2',
};

export function themeDailyDigest(markup: string) {
  const clean = markup.replace(/<style id="sparkflow-digest-theme">[\s\S]*?<\/style>/gi, '');
  const themed = clean.replace(/<style\b[^>]*>[\s\S]*?<\/style>|\b(?:style|bgcolor)=(?:"[^"]*"|'[^']*')/gi,
    style => style.replace(/#[a-f0-9]{6}\b/gi, color => colors[color.toLowerCase()] ?? color));
  const css = `<style id="sparkflow-digest-theme">
html{color-scheme:dark!important;overflow-y:auto;overflow-x:hidden;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-y:contain}
html::-webkit-scrollbar,body::-webkit-scrollbar{display:none;width:0;height:0}
body{margin:0;background:#081514!important;color:#c6d8d0!important;scrollbar-width:none}
.outer{padding:12px 20px 20px!important}
.outer>table{width:100%!important;max-width:760px!important;margin:0 auto;min-height:100vh}
.masthead{padding:18px 32px!important;border-top-color:#54c8ac!important}
.masthead>table+table{margin-top:12px!important}.headline{font-size:32px!important}
.art-column,.geometry-cell{width:132px!important}.masthead img{max-width:130px!important;max-height:72px!important;width:auto!important;height:auto!important}
.content{padding-left:32px!important;padding-right:32px!important}
a:focus-visible{outline:2px solid #86d5b7}a{color:#8ddcbf}
img{max-width:100%;filter:grayscale(1) invert(1);mix-blend-mode:screen;opacity:.78}
@media(max-width:480px){.outer{padding:8px!important}.masthead{padding:16px 20px!important}.content{padding-left:20px!important;padding-right:20px!important}.headline{font-size:28px!important}.art-column,.geometry-cell{width:100px!important}.masthead img{max-width:100px!important;max-height:60px!important}}
</style>`;
  return themed.replace(/(<meta\b[^>]*name="(?:supported-)?color-schemes?"[^>]*content=")light("[^>]*>)/gi, '$1dark$2').replace('</head>', css + '</head>');
}
