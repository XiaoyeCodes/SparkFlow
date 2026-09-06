"""Local, source-linked account reports. No data is sent to an AI service."""
from html import escape
import hashlib
import json
from pathlib import Path
import re
import threading
from tempfile import TemporaryDirectory
from typing import Literal

from pydantic import AwareDatetime, Field, HttpUrl, model_validator
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .analytics import AccountRiskAnalysis, RiskMetric, analyze_snapshot
from .risk import canonical
from .schemas import Contract, Snapshot


class AccountReport(Contract):
    reportHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    snapshotHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    snapshotId: str
    testData: bool
    analysis: AccountRiskAnalysis
    files: dict[str, Path]


class ReportMetadata(Contract):
    reportHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    snapshotHash: str = Field(pattern=r'^[0-9a-f]{64}$')
    snapshotId: str
    accountKey: str
    mode: str
    generatedAt: str
    status: str
    testData: bool
    formats: tuple[str, ...] = ('json', 'markdown', 'html', 'pdf')


class ReportError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class ReportEvidence(Contract):
    evidenceId: str = Field(min_length=1, max_length=200)
    kind: Literal['news', 'macro', 'micro']
    title: str = Field(min_length=1, max_length=1000)
    summary: str = Field(max_length=10_000)
    source: str = Field(min_length=1, max_length=500)
    url: HttpUrl
    publishedAt: AwareDatetime | None = None
    fetchedAt: AwareDatetime
    linkedConIds: tuple[int, ...] = Field(default=(), max_length=50)
    relation: Literal['SYMBOL_MENTION', 'ACCOUNT_CONTEXT_NOT_CAUSAL']
    testData: bool

    @model_validator(mode='after')
    def valid_relation(self):
        if any(value <= 0 for value in self.linkedConIds) or len(set(self.linkedConIds)) != len(self.linkedConIds):
            raise ValueError('invalid evidence holding scope')
        if self.relation == 'SYMBOL_MENTION' and not self.linkedConIds:
            raise ValueError('symbol relation requires an explicit holding')
        if self.kind != 'news' and self.relation == 'SYMBOL_MENTION':
            raise ValueError('only news may use symbol mention relation')
        return self


class ReportEvidenceBundle(Contract):
    generatedAt: AwareDatetime
    items: tuple[ReportEvidence, ...] = Field(default=(), max_length=100)
    gaps: tuple[Literal['NEWS_UNAVAILABLE', 'NEWS_EMPTY', 'MACRO_UNAVAILABLE', 'MACRO_EMPTY', 'MICRO_PERMISSION_REQUIRED'], ...] = Field(default=(), max_length=5)

    @model_validator(mode='after')
    def unique_items(self):
        if len({row.evidenceId for row in self.items}) != len(self.items) or len(set(self.gaps)) != len(self.gaps):
            raise ValueError('duplicate report evidence')
        return self


def _checked_evidence(snapshot, evidence, now):
    value = evidence or ReportEvidenceBundle(generatedAt=now, items=(),
        gaps=('NEWS_UNAVAILABLE', 'MACRO_UNAVAILABLE', 'MICRO_PERMISSION_REQUIRED'))
    value = ReportEvidenceBundle.model_validate(value.model_dump())
    holdings = {row.conId for row in snapshot.positions}
    for row in value.items:
        if row.testData != snapshot.testData:
            raise ReportError('EVIDENCE_PROVENANCE_MISMATCH')
        if any(con_id not in holdings for con_id in row.linkedConIds):
            raise ReportError('EVIDENCE_SCOPE_MISMATCH')
    return value


def _json_hash(value):
    payload = value.model_dump(mode='json') if hasattr(value, 'model_dump') else value
    body = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(body.encode()).hexdigest()


def _display(metric: RiskMetric):
    return metric.value if metric.value is not None else '数据缺失'


def _md_cell(value):
    return str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('|', '&#124;').replace('\r', ' ').replace('\n', ' ')


def _rows(analysis):
    return [
        ('总敞口', _display(analysis.metrics.grossExposure), analysis.metrics.grossExposure.unit),
        ('净敞口', _display(analysis.metrics.netExposure), analysis.metrics.netExposure.unit),
        ('最大仓位权重', _display(analysis.metrics.largestPositionWeight), 'ratio'),
        ('保证金使用率', _display(analysis.metrics.marginUsage), 'ratio'),
        ('基础币种现金合计', analysis.totalCashBase if analysis.totalCashBase is not None else '数据缺失', 'USD'),
        ('持仓数量', str(analysis.positionCount) if analysis.positionCount is not None else '数据缺失', 'count'),
        ('挂单数量', str(analysis.openOrderCount) if analysis.openOrderCount is not None else '数据缺失', 'count'),
    ]


def _evidence(analysis):
    values = [*analysis.metrics.grossExposure.evidence, *analysis.metrics.netExposure.evidence,
        *analysis.metrics.largestPositionWeight.evidence, *analysis.metrics.marginUsage.evidence,
        *analysis.cashEvidence, *analysis.openOrderEvidence]
    unique = {}
    for row in values:
        unique[(row.field, row.value, row.source, row.observedAt)] = row
    return list(unique.values())


def _narrative(analysis, evidence):
    count = '数据缺失' if analysis.positionCount is None else str(analysis.positionCount)
    orders = '数据缺失' if analysis.openOrderCount is None else str(analysis.openOrderCount)
    cash = analysis.totalCashBase if analysis.totalCashBase is not None else '数据缺失'
    return {
        'summary': f'确定性账户分析状态为 {analysis.status}；所有数字均绑定快照 {analysis.snapshotId}。',
        'accountOverview': f'基础币种 {analysis.metrics.grossExposure.unit}；持仓 {count}；挂单 {orders}；可合成的基础币种现金 {cash}。',
        'performanceAttribution': '数据缺失：当前快照不含期初权益、净现金流及分段收益，未计算收益归因。',
        'recommendations': '先补齐缺失数据并核对账户、行情和授权；本报告不选择策略、风险额度或交易动作。',
        'limitations': [
            '仅使用单一只读账户快照，不能证明未来表现、成交能力或真实流动性。',
            f'外部证据缺口：{", ".join(evidence.gaps) if evidence.gaps else "无已声明缺口"}。',
            '新闻与宏观证据只作上下文；没有明确的因果或交易结论。',
        ],
    }


def _markdown(analysis, report_hash, snapshot_hash, evidence):
    badge = '工程测试数据；不是 IBKR 账户事实。' if analysis.testData else '本地只读账户快照报告。'
    narrative = _narrative(analysis, evidence)
    lines = [f'# SparkFlow IBKR 账户风险报告', '', badge, '', 'AI 账户分享：关闭', '',
        f'- 账户：`{analysis.accountKey}`', f'- 模式：`{analysis.mode}`', f'- 快照：`{analysis.snapshotId}`',
        f'- 快照时间：{analysis.asOf or "缺失"}', f'- 分析状态：{analysis.status}',
        f'- 报告哈希：`{report_hash}`', f'- 快照哈希：`{snapshot_hash}`',
        '', '## 摘要', '', narrative['summary'], '', '## 账户概况', '', narrative['accountOverview'],
        '', '## 收益归因', '', narrative['performanceAttribution'], '', '## 确定性风险指标', '',
        '| 指标 | 数值 | 单位 |', '| --- | --- | --- |']
    lines.extend(f'| {name} | {value} | {unit} |' for name, value, unit in _rows(analysis))
    lines.extend(['', '## 风险与缺失项', ''])
    lines.extend(f'- `{finding.code}` {finding.explanation}' for finding in analysis.findings)
    lines.extend(['', '## 证据', '', '| 字段 | 原值 | 来源 | 观察时间 | 快照 |', '| --- | --- | --- | --- | --- |'])
    lines.extend(f'| {_md_cell(row.field)} | {_md_cell(row.value)} | {_md_cell(row.source)} | {_md_cell(row.observedAt or "未提供")} | {_md_cell(row.snapshotId)} |' for row in _evidence(analysis))
    lines.extend(['', '## 新闻、宏观与微观证据', '', '这些证据仅作账户上下文；`ACCOUNT_CONTEXT_NOT_CAUSAL` 明确表示没有因果结论。', '',
        '| 类型 | 标题 | 来源 URL | 抓取时间 | 关联 | conId |', '| --- | --- | --- | --- | --- | --- |'])
    lines.extend(f'| {_md_cell(row.kind)} | {_md_cell(row.title)} | `{_md_cell(row.url)}` | {_md_cell(row.fetchedAt.isoformat())} | {_md_cell(row.relation)} | {_md_cell(", ".join(map(str, row.linkedConIds)) or "账户级")} |' for row in evidence.items)
    if evidence.gaps:
        lines.extend(['', '证据缺口：'] + [f'- `{gap}`' for gap in evidence.gaps])
    lines.extend(['', '## 建议', '', narrative['recommendations'], '', '## 来源与限制', ''])
    lines.extend(f'- {value}' for value in narrative['limitations'])
    lines.extend(['', '本报告只解释和导出已提供的只读快照，不创建订单、授权或 AI 调用。', ''])
    return '\n'.join(lines)


def _html(analysis, report_hash, snapshot_hash, report_evidence):
    narrative = _narrative(analysis, report_evidence)
    metric_rows = ''.join(f'<tr><th>{escape(name)}</th><td>{escape(value)}</td><td>{escape(unit)}</td></tr>' for name, value, unit in _rows(analysis))
    findings = ''.join(f'<li><code>{escape(row.code)}</code> {escape(row.explanation)}</li>' for row in analysis.findings)
    evidence = ''.join(f'<tr><td>{escape(row.field)}</td><td>{escape(row.value)}</td><td>{escape(row.source)}</td><td>{escape(row.observedAt or "未提供")}</td><td>{escape(row.snapshotId)}</td></tr>' for row in _evidence(analysis))
    badge = '工程测试数据；不是 IBKR 账户事实。' if analysis.testData else '本地只读账户快照报告。'
    external = ''.join(f'<tr><td>{escape(row.kind)}</td><td>{escape(row.title)}</td><td><a href="{escape(str(row.url))}">{escape(row.source)}</a></td><td>{escape(row.fetchedAt.isoformat())}</td><td>{escape(row.relation)}</td><td>{escape(", ".join(map(str, row.linkedConIds)) or "账户级")}</td></tr>' for row in report_evidence.items)
    gaps = ''.join(f'<li><code>{escape(value)}</code></li>' for value in report_evidence.gaps)
    limitations = ''.join(f'<li>{escape(value)}</li>' for value in narrative['limitations'])
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>SparkFlow IBKR 账户风险报告</title><style>
body{{font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif;color:#dcebe5;background:#071512;margin:0}}main{{max-width:980px;margin:24px auto;padding:28px;background:#0d211c;border:1px solid #28493e}}h1,h2{{color:#b8f3d2}}.badge{{color:#e6c678}}table{{width:100%;border-collapse:collapse;margin:12px 0}}th,td{{border-bottom:1px solid #29483e;padding:8px;text-align:left;vertical-align:top}}code{{color:#9bd8ba;word-break:break-all}}.hashes{{font-size:12px}}a{{color:#b8f3d2}}</style></head><body><main><h1>SparkFlow IBKR 账户风险报告</h1><p class="badge">{escape(badge)}</p><p>AI 账户分享：关闭</p><p>账户：<code>{escape(analysis.accountKey)}</code><br>模式：{escape(analysis.mode)}<br>快照：<code>{escape(analysis.snapshotId)}</code><br>快照时间：{escape(analysis.asOf or '缺失')}<br>分析状态：{escape(analysis.status)}</p><div class="hashes">报告哈希：<code>{report_hash}</code><br>快照哈希：<code>{snapshot_hash}</code></div><h2>摘要</h2><p>{escape(narrative['summary'])}</p><h2>账户概况</h2><p>{escape(narrative['accountOverview'])}</p><h2>收益归因</h2><p>{escape(narrative['performanceAttribution'])}</p><h2>确定性风险指标</h2><table><tbody>{metric_rows}</tbody></table><h2>风险与缺失项</h2><ul>{findings}</ul><h2>账户字段证据</h2><table><thead><tr><th>字段</th><th>原值</th><th>来源</th><th>观察时间</th><th>快照</th></tr></thead><tbody>{evidence}</tbody></table><h2>新闻、宏观与微观证据</h2><p>这些证据只作账户上下文；ACCOUNT_CONTEXT_NOT_CAUSAL 不表示因果关系。</p><table><thead><tr><th>类型</th><th>标题</th><th>来源</th><th>抓取时间</th><th>关联</th><th>conId</th></tr></thead><tbody>{external}</tbody></table><h2>证据缺口</h2><ul>{gaps}</ul><h2>建议</h2><p>{escape(narrative['recommendations'])}</p><h2>来源与限制</h2><ul>{limitations}</ul><p>本报告只解释和导出已提供的只读快照，不创建订单、授权或 AI 调用。</p></main></body></html>'''


def _pdf(path, analysis, report_hash, snapshot_hash, report_evidence):
    narrative = _narrative(analysis, report_evidence)
    font_name = 'STSong-Light'
    candidates = [Path('C:/Windows/Fonts/msyh.ttc'), Path('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc')]
    selected = next((candidate for candidate in candidates if candidate.exists()), None)
    if selected is not None:
        font_name = 'SparkFlowCJK'
        if font_name not in pdfmetrics.getRegisteredFontNames():
            pdfmetrics.registerFont(TTFont(font_name, str(selected), subfontIndex=0))
    elif font_name not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(UnicodeCIDFont(font_name))
    styles = getSampleStyleSheet()
    base = ParagraphStyle('Chinese', parent=styles['BodyText'], fontName=font_name, fontSize=9, leading=14, textColor=colors.HexColor('#193a31'))
    title = ParagraphStyle('TitleChinese', parent=base, fontSize=18, leading=24, alignment=TA_CENTER, textColor=colors.HexColor('#0f5138'), spaceAfter=10)
    heading = ParagraphStyle('HeadingChinese', parent=base, fontSize=12, leading=18, textColor=colors.HexColor('#0f5138'), spaceBefore=10, spaceAfter=6)
    small = ParagraphStyle('SmallChinese', parent=base, fontSize=7, leading=10, textColor=colors.HexColor('#47695e'))
    temporary = path.with_suffix('.pdf.tmp')
    document = SimpleDocTemplate(str(temporary), pagesize=A4, rightMargin=16*mm, leftMargin=16*mm, topMargin=18*mm, bottomMargin=18*mm,
        title='SparkFlow IBKR 账户风险报告', author='SparkFlow')
    story = [Paragraph('SparkFlow IBKR 账户风险报告', title),
        Paragraph('工程测试数据；不是 IBKR 账户事实。' if analysis.testData else '本地只读账户快照报告。', base),
        Paragraph('AI 账户分享：关闭', base), Spacer(1, 4*mm),
        Paragraph(f'账户：{escape(analysis.accountKey)}<br/>模式：{escape(analysis.mode)}<br/>快照：{escape(analysis.snapshotId)}<br/>快照时间：{escape(analysis.asOf or "缺失")}<br/>分析状态：{analysis.status}', base),
        Paragraph(f'报告哈希：{report_hash}<br/>快照哈希：{snapshot_hash}', small),
        Paragraph('摘要', heading), Paragraph(escape(narrative['summary']), base),
        Paragraph('账户概况', heading), Paragraph(escape(narrative['accountOverview']), base),
        Paragraph('收益归因', heading), Paragraph(escape(narrative['performanceAttribution']), base),
        Paragraph('确定性风险指标', heading)]
    metric_data = [[Paragraph('指标', base), Paragraph('数值', base), Paragraph('单位', base)]] + [[Paragraph(escape(name), base), Paragraph(escape(value), base), Paragraph(escape(unit), base)] for name, value, unit in _rows(analysis)]
    metric_table = Table(metric_data, colWidths=[60*mm, 60*mm, 35*mm], repeatRows=1)
    metric_table.setStyle(TableStyle([('BACKGROUND', (0,0), (-1,0), colors.HexColor('#d8f2e5')), ('GRID',(0,0),(-1,-1),0.35,colors.HexColor('#8eb8a7')), ('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),5), ('RIGHTPADDING',(0,0),(-1,-1),5)]))
    story.extend([metric_table, Paragraph('风险与缺失项', heading)])
    story.extend(Paragraph(f'{escape(row.code)} - {escape(row.explanation)}', base) for row in analysis.findings)
    story.append(Paragraph('证据', heading))
    evidence_data = [[Paragraph(value, small) for value in ('字段','原值','来源','观察时间','快照')]]
    evidence_data.extend([[Paragraph(escape(row.field), small), Paragraph(escape(row.value), small), Paragraph(escape(row.source), small), Paragraph(escape(row.observedAt or '未提供'), small), Paragraph(escape(row.snapshotId), small)] for row in _evidence(analysis)])
    evidence_table = Table(evidence_data, colWidths=[35*mm, 23*mm, 34*mm, 39*mm, 34*mm], repeatRows=1)
    evidence_table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#d8f2e5')), ('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#8eb8a7')), ('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),3), ('RIGHTPADDING',(0,0),(-1,-1),3)]))
    story.extend([evidence_table, Paragraph('新闻、宏观与微观证据', heading), Paragraph('仅作账户上下文；ACCOUNT_CONTEXT_NOT_CAUSAL 不表示因果关系。', small)])
    external_data = [[Paragraph(value, small) for value in ('类型','标题','来源','时间','关联')]]
    external_data.extend([[Paragraph(escape(row.kind), small), Paragraph(escape(row.title), small),
        Paragraph(f'<link href="{escape(str(row.url))}">{escape(row.source)}</link>', small), Paragraph(escape(row.fetchedAt.isoformat()), small),
        Paragraph(escape(f'{row.relation} / {", ".join(map(str, row.linkedConIds)) or "账户级"}'), small)] for row in report_evidence.items])
    external_table = Table(external_data, colWidths=[18*mm, 39*mm, 31*mm, 39*mm, 38*mm], repeatRows=1)
    external_table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#d8f2e5')), ('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#8eb8a7')), ('VALIGN',(0,0),(-1,-1),'TOP'), ('LEFTPADDING',(0,0),(-1,-1),3), ('RIGHTPADDING',(0,0),(-1,-1),3)]))
    story.extend([external_table, Paragraph(f'证据缺口：{escape(", ".join(report_evidence.gaps) or "无")}', small),
        Paragraph('建议', heading), Paragraph(escape(narrative['recommendations']), base),
        Paragraph('来源与限制', heading)])
    story.extend(Paragraph(f'• {escape(value)}', small) for value in narrative['limitations'])
    story.extend([Spacer(1, 4*mm), Paragraph('本报告只解释和导出已提供的只读快照，不创建订单、授权或 AI 调用。', small)])

    def footer(canvas, doc):
        canvas.saveState(); canvas.setFont(font_name, 7); canvas.setFillColor(colors.HexColor('#58776d'))
        canvas.drawString(16*mm, 9*mm, f'SparkFlow · {analysis.snapshotId}')
        canvas.drawRightString(A4[0] - 16*mm, 9*mm, f'第 {doc.page} 页')
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    temporary.replace(path)


def build_account_report(snapshot: Snapshot, output_root: Path, *, now, max_age_seconds=60, evidence: ReportEvidenceBundle | None = None):
    snapshot = Snapshot.model_validate(snapshot.model_dump())
    analysis = analyze_snapshot(snapshot, now=now, max_age_seconds=max_age_seconds)
    evidence = _checked_evidence(snapshot, evidence, now)
    narrative = _narrative(analysis, evidence)
    snapshot_hash = _json_hash(snapshot)
    report_hash = _json_hash({'reportSchemaVersion': 2, 'snapshotHash': snapshot_hash,
        'analysis': analysis.model_dump(mode='json'), 'evidence': evidence.model_dump(mode='json'), 'narrative': narrative})
    directory = output_root / report_hash
    directory.mkdir(parents=True, exist_ok=True)
    paths = {kind: directory / f'account-risk.{extension}' for kind, extension in
        (('json', 'json'), ('markdown', 'md'), ('html', 'html'), ('pdf', 'pdf'))}
    package = {'reportSchemaVersion': 2, 'reportHash': report_hash, 'snapshotHash': snapshot_hash,
        'snapshot': snapshot.model_dump(mode='json'), 'analysis': analysis.model_dump(mode='json'),
        'evidence': evidence.model_dump(mode='json'), 'narrative': narrative}
    contents = {'json': json.dumps(package, ensure_ascii=False, sort_keys=True, indent=2),
        'markdown': _markdown(analysis, report_hash, snapshot_hash, evidence), 'html': _html(analysis, report_hash, snapshot_hash, evidence)}
    for kind, content in contents.items():
        temporary = paths[kind].with_suffix(paths[kind].suffix + '.tmp')
        temporary.write_text(content, encoding='utf-8')
        temporary.replace(paths[kind])
    _pdf(paths['pdf'], analysis, report_hash, snapshot_hash, evidence)
    return AccountReport(reportHash=report_hash, snapshotHash=snapshot_hash, snapshotId=snapshot.snapshotId,
        testData=snapshot.testData, analysis=analysis, files=paths)


class LocalReportStore:
    """A server-owned report directory with hash-only lookup and account scoping."""
    _hash = re.compile(r'^[0-9a-f]{64}$')
    _extensions = {'json': 'json', 'markdown': 'md', 'html': 'html', 'pdf': 'pdf'}

    def __init__(self, root: Path, *, clock):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.clock = clock
        self._lock = threading.RLock()

    def _package(self, report_hash: str):
        if not self._hash.fullmatch(report_hash):
            raise ReportError('REPORT_MISSING')
        path = self.root / report_hash / 'account-risk.json'
        try:
            package = json.loads(path.read_text(encoding='utf-8'))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            raise ReportError('REPORT_MISSING') from None
        if package.get('reportHash') != report_hash:
            raise ReportError('REPORT_HASH_MISMATCH')
        snapshot = Snapshot.model_validate(package.get('snapshot'))
        if _json_hash(snapshot) != package.get('snapshotHash'):
            raise ReportError('REPORT_HASH_MISMATCH')
        if package.get('reportSchemaVersion') == 2:
            expected = _json_hash({'reportSchemaVersion': 2, 'snapshotHash': package['snapshotHash'],
                'analysis': package.get('analysis'), 'evidence': package.get('evidence'), 'narrative': package.get('narrative')})
        elif 'evidence' not in package:
            expected = _json_hash({'snapshotHash': package['snapshotHash'], 'analysis': package.get('analysis')})
        else:
            expected = _json_hash({'snapshotHash': package['snapshotHash'], 'analysis': package.get('analysis'), 'evidence': package.get('evidence')})
        if expected != report_hash:
            raise ReportError('REPORT_HASH_MISMATCH')
        return package, snapshot

    @staticmethod
    def _metadata(package, snapshot):
        analysis = package['analysis']
        return ReportMetadata(reportHash=package['reportHash'], snapshotHash=package['snapshotHash'],
            snapshotId=snapshot.snapshotId, accountKey=snapshot.accountKey, mode=snapshot.mode,
            generatedAt=analysis['generatedAt'], status=analysis['status'], testData=snapshot.testData)

    def create(self, snapshot: Snapshot, *, evidence: ReportEvidenceBundle | None = None, guard=lambda: None):
        with self._lock:
            guard()
            with TemporaryDirectory(dir=self.root, prefix='.report-job-') as staging:
                report = build_account_report(snapshot, Path(staging), now=self.clock(), evidence=evidence)
                guard()
                published = self.root / report.reportHash
                if not published.exists():
                    (Path(staging) / report.reportHash).replace(published)
            package, checked = self._package(report.reportHash)
            return self._metadata(package, checked)

    def list(self, mode: str, account_key: str):
        items = []
        with self._lock:
            for directory in self.root.iterdir():
                if not directory.is_dir() or not self._hash.fullmatch(directory.name):
                    continue
                try:
                    package, snapshot = self._package(directory.name)
                except ReportError:
                    continue
                if snapshot.mode == mode and snapshot.accountKey == account_key:
                    items.append(self._metadata(package, snapshot))
        return sorted(items, key=lambda value: (value.generatedAt, value.reportHash), reverse=True)

    def file(self, report_hash: str, kind: str, mode: str, account_key: str):
        if kind not in self._extensions:
            raise ReportError('REPORT_FORMAT_UNSUPPORTED')
        with self._lock:
            _, snapshot = self._package(report_hash)
            if snapshot.mode != mode or snapshot.accountKey != account_key:
                raise ReportError('REPORT_SCOPE_MISMATCH')
            path = self.root / report_hash / f'account-risk.{self._extensions[kind]}'
            if not path.is_file():
                raise ReportError('REPORT_FILE_MISSING')
            return path
