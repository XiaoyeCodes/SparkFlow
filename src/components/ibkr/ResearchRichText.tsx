import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './ResearchRichText.css';

type TextNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: TextNode[] };
const emphasis = /(?:[$¥￥€]?[+−-]?\d[\d,]*(?:\.\d+)?(?:%|％|万亿|亿|万|美元|人民币|元|倍|bp|个百分点)?)|\b[A-Z][A-Z0-9]*(?:[.-][A-Z]+)?\b|估值过高|价值投资机会|安全边际|现金流|护城河|增长质量|盈利增速|行业轮动|集中度|流动性|汇率|地缘风险|风险|机会|缺口|保证金|优先/g;
// Add safe text spans after Markdown parsing; never interpret model HTML.
function highlightResearch() {
  return (tree: TextNode) => {
    const visit = (parent: TextNode) => {
      if (!parent.children || ['code', 'pre', 'a'].includes(parent.tagName || '')) return;
      parent.children = parent.children.flatMap(node => {
        if (node.type !== 'text' || !node.value) { visit(node); return [node]; }
        const result: TextNode[] = []; let cursor = 0;
        for (const match of node.value.matchAll(emphasis)) {
          if (match.index! > cursor) result.push({ type: 'text', value: node.value.slice(cursor, match.index) });
          const word = match[0];
          const kind = /\d/.test(word) && !/^[A-Z]/.test(word) ? 'number' : /^[A-Z]/.test(word) ? 'ticker' : /风险|缺口|估值过高|保证金/.test(word) ? 'risk' : /机会|安全边际|护城河/.test(word) ? 'opportunity' : 'keyword';
          result.push({ type: 'element', tagName: 'span', properties: { className: [`awb-research-${kind}`] }, children: [{ type: 'text', value: word }] });
          cursor = match.index! + word.length;
        }
        if (cursor < node.value.length) result.push({ type: 'text', value: node.value.slice(cursor) });
        return result;
      });
    };
    visit(tree);
  };
}
const remarkPlugins = [remarkGfm];
const rehypePlugins = [highlightResearch];
export const ResearchRichText = memo(function ResearchRichText({ text, className = '' }: { text?: string; className?: string }) {
  return text ? <div className={`awb-research-prose ${className}`}><ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{text}</ReactMarkdown></div> : null;
});
