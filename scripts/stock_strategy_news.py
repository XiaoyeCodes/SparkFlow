"""Public RSS news adapter for DSA; model credentials never reach news hosts."""
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import html
import re
import time
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import requests
from src.search_service import BaseSearchProvider, SearchResult, SearchResponse


class PublicNewsProvider(BaseSearchProvider):
    def __init__(self, engine, proxy_url=""):
        super().__init__([], f"{engine} News RSS")
        self.engine = engine
        self.proxy_url = proxy_url

    @property
    def is_available(self):
        return True

    def _do_search(self, query, api_key, max_results, days=7):
        return self.search(query, max_results, days)

    def search(self, query, max_results=5, days=7):
        started = time.monotonic()
        now = datetime.now(timezone.utc)
        days = max(1, min(int(days), 365))
        chinese = bool(re.search(r"[\u3400-\u9fff]", query))
        # RSS search treats long Chinese queries loosely. Preserve the named
        # subject as an exact phrase; the engine still applies identity filters.
        first_term = query.split()[0] if query.split() else ""
        feed_query = query
        if chinese and re.fullmatch(r"[\u3400-\u9fff]{2,12}", first_term):
            feed_query = '"' + first_term + '"' + query[len(first_term):]
            if re.fullmatch(r"[\u3400-\u9fff]{2,12}\s+\d{6}\s+股票\s+最新消息", query):
                feed_query = '"' + first_term + '"'
        if self.engine == "Google":
            url = "https://news.google.com/rss/search"
            params = {"q": f"{feed_query} when:{days}d", "hl": "zh-CN" if chinese else "en-US",
                      "gl": "CN" if chinese else "US", "ceid": "CN:zh-Hans" if chinese else "US:en"}
        else:
            url = "https://www.bing.com/news/search"
            params = {"q": feed_query, "format": "rss"}
        try:
            with requests.Session() as session:
                session.trust_env = False
                # Public-data proxy is independent from the model's useProxy setting.
                if self.engine == "Google" and self.proxy_url:
                    session.proxies.update({"http": self.proxy_url, "https": self.proxy_url})
                response = session.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=(3, 7))
                response.raise_for_status()
                if len(response.content) > 3_000_000:
                    raise ValueError("RSS response too large")
                try:
                    root = ET.fromstring(response.content)
                except ET.ParseError:
                    if self.engine != "Bing" or not self.proxy_url:
                        raise
                    # Some networks redirect Bing RSS to the HTML landing page.
                    session.proxies.update({"http": self.proxy_url, "https": self.proxy_url})
                    response = session.get(url, params=params, headers={"User-Agent": "Mozilla/5.0"}, timeout=(3, 7))
                    response.raise_for_status()
                    if len(response.content) > 3_000_000:
                        raise ValueError("RSS response too large")
                    root = ET.fromstring(response.content)
            results, seen = [], set()
            for item in root.findall(".//item"):
                title = html.unescape(item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                published = item.findtext("pubDate")
                try:
                    date = parsedate_to_datetime(published).astimezone(timezone.utc)
                except (TypeError, ValueError, AttributeError):
                    continue
                if not title or urlparse(link).scheme not in ("https", "http") or link in seen:
                    continue
                if not now - timedelta(days=days) <= date <= now + timedelta(minutes=10):
                    continue
                source = item.findtext("source") or item.findtext("{https://www.bing.com/news/search}Source") or self.name
                snippet = html.unescape(re.sub(r"<[^>]*>", " ", item.findtext("description") or ""))
                snippet = re.sub(r"\s+", " ", snippet).strip()[:2000]
                results.append(SearchResult(title=title, snippet=snippet, url=link, source=source,
                                            published_date=date.isoformat()))
                seen.add(link)
            # Keep the provider's relevance order before DSA's identity ranking.
            result = SearchResponse(query=query, results=results[:max_results], provider=self.name,
                                    search_time=time.monotonic() - started)
            result.mark_retrieved()
            return result
        except (requests.RequestException, ValueError, ET.ParseError):
            return SearchResponse(query=query, results=[], provider=self.name, success=False,
                                  error_message=f"{self.name} 暂不可用", search_time=time.monotonic() - started)


def install_news_adapter(proxy_url=""):
    import src.search_service as search
    if getattr(search.SearchService, "_sparkflow_public_news", False):
        return
    original = search.SearchService

    class SparkFlowSearchService(original):
        _sparkflow_public_news = True

        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self._providers.extend([PublicNewsProvider("Google", proxy_url), PublicNewsProvider("Bing", proxy_url)])

    search.SearchService = SparkFlowSearchService
