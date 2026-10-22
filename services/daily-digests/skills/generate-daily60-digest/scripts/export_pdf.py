#!/usr/bin/env python3
"""Export the skill's self-contained HTML locally. Never fetch remote resources."""
import argparse
import math
from pathlib import Path


def export_pdf(html_path, output, layout='continuous'):
    try:
        import weasyprint
        from weasyprint import HTML, CSS
        from weasyprint.urls import URLFetcher, FatalURLFetchingError
    except ImportError as error:
        raise RuntimeError('Install PDF dependencies: python -m pip install -r requirements-pdf.txt') from error
    source = Path(html_path).read_text(encoding='utf-8')
    if 'cid:' in source:
        raise ValueError('Use the standalone .html, not the CID .email.html, for PDF export')
    embedded_only = URLFetcher(allowed_protocols={'data'}, allow_redirects=False, fail_on_errors=True)
    base = ('html,body{margin:0;padding:0}td{text-align:left}td[align=right]{text-align:right}'
            'td[align=center]{text-align:center}.masthead,.content,.footer{text-align:left}'
            '.paper{width:640px!important;margin-left:auto;margin-right:auto}')
    html = HTML(string=source, media_type='print', url_fetcher=embedded_only)
    def render_document(css):
        try:
            return html.render(stylesheets=[CSS(string=css)], presentational_hints=True)
        except FatalURLFetchingError as error:
            raise RuntimeError('PDF resource blocked or invalid; use only the bundled embedded artwork') from error
    if layout == 'continuous':
        measured = render_document('@page{size:800px 30000px;margin:0}'+base)
        if len(measured.pages) != 1:
            raise ValueError('Edition exceeds the continuous-PDF page limit; choose --layout a4')
        boxes = measured.pages[0]._page_box.descendants()
        height = math.ceil(max(b.position_y+b.height for b in boxes if b.element_tag == 'table')) + 1
        css = f'@page{{size:800px {height}px;margin:0}}' + base
    elif layout == 'a4':
        css = ('@page{size:A4;margin:12mm}'+base+
               '.outer{padding:0!important}.paper{width:640px!important}tr{break-inside:auto}'
               '.news-list>tbody>tr,.news-list>tr,.story{break-inside:avoid}'
               '.footer{break-inside:avoid}')
    else:
        raise ValueError('layout must be continuous or a4')
    document = render_document(css)
    if not document.pages:
        raise ValueError('PDF has no pages')
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    tmp = output.with_name(output.name+'.tmp')
    document.write_pdf(tmp)
    tmp.replace(output)
    return {'file':output.name,'layout':layout,'page_count':len(document.pages),
            'renderer':'WeasyPrint '+weasyprint.__version__,
            'note':'Same text and approved design; font metrics/pagination may differ from email clients.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--layout',choices=['continuous','a4'],default='continuous')
    args = parser.parse_args()
    import json
    print(json.dumps(export_pdf(args.html,args.output,args.layout),ensure_ascii=False,indent=2))


if __name__ == '__main__':main()
