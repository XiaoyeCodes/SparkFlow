"""Routes public source reads. No fallback after denial and no TLS verification bypass."""
import os
import urllib.request
from urllib.parse import urlsplit


def install_routes():
    original = urllib.request.build_opener
    proxy = os.environ.get('SPARKFLOW_DIGEST_PROXY', 'http://127.0.0.1:7890')
    direct = {'news.aibase.cn', 'xnews.jin10.com', '60s-static.viki.moe'}

    class Routes(urllib.request.ProxyHandler):
        def __init__(self):
            super().__init__({'https': proxy} if proxy and proxy != 'direct' else {})

        def proxy_open(self, request, proxy_url, scheme):
            if urlsplit(request.full_url).hostname in direct:
                return None
            return super().proxy_open(request, proxy_url, scheme)

    # Preserve each vendor's strict redirect handler. Only route selection is supplied.
    def build(*handlers):
        return original(Routes(), *handlers)
    urllib.request.build_opener = build
    urllib.request.install_opener(build())
