import React from 'react';

interface SafeMarkdownProps {
  content: string;
  className?: string;
}

/**
 * 安全 React Markdown 排版元件：
 * - 不使用 dangerouslySetInnerHTML，自動以 React 文字節點逃脫所有原始 HTML 標籤
 * - 支援標題 (#, ##, ###)、粗體 (**text**)、行內代碼 (`code`)、無序/有序清單、引用與 Markdown 表格
 */
export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({ content, className = '' }) => {
  if (!content || !content.trim()) {
    return <p className="text-slate-400 italic rf-body text-xs">（尚無內容）</p>;
  }

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  const renderInline = (text: string, keyPrefix: string): React.ReactNode[] => {
    // Parse **bold**, `code`, and 【tag】 safely
    const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return tokens.map((part, idx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={`${keyPrefix}-b-${idx}`} className="font-bold text-slate-900">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={`${keyPrefix}-c-${idx}`}
            className="px-1 py-0.5 bg-slate-100 text-slate-800 rounded font-mono rf-sm text-[11px] break-all"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      return <React.Fragment key={`${keyPrefix}-t-${idx}`}>{part}</React.Fragment>;
    });
  };

  const isTableSeparator = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.includes('|')) return false;
    const cells = trimmed.replace(/^\||\|$/g, '').split('|');
    return cells.length > 0 && cells.every((c) => /^[\s:-]+$/.test(c));
  };

  const splitTableRow = (line: string): string[] => {
    return line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());
  };

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-slate-200" />);
      i += 1;
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      if (level === 1) {
        elements.push(
          <h3 key={`h-${i}`} className="rf-h2 text-sm font-black text-slate-900 mt-3 mb-1.5 rf-section-heading">
            {renderInline(text, `h-${i}`)}
          </h3>
        );
      } else if (level === 2) {
        elements.push(
          <h4 key={`h-${i}`} className="rf-h3 text-[13px] font-extrabold text-slate-900 mt-2.5 mb-1 rf-section-heading">
            {renderInline(text, `h-${i}`)}
          </h4>
        );
      } else {
        elements.push(
          <h5 key={`h-${i}`} className="rf-body text-xs font-bold text-slate-800 mt-2 mb-1 rf-section-heading">
            {renderInline(text, `h-${i}`)}
          </h5>
        );
      }
      i += 1;
      continue;
    }

    // Markdown Table (header | row followed by separator | --- |)
    if (trimmed.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      elements.push(
        <div key={`tbl-${i}`} className="my-2 overflow-x-auto print:overflow-visible">
          <table className="rf-table w-full text-left rf-sm text-[11px] border border-slate-200 border-collapse">
            <thead className="bg-slate-100 text-slate-800 font-bold">
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} className="p-2 border border-slate-200 align-top">
                    {renderInline(h, `th-${i}-${hIdx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="odd:bg-white even:bg-slate-50/50">
                  {headers.map((_, cIdx) => (
                    <td key={cIdx} className="p-2 border border-slate-200 text-slate-700 align-top break-words">
                      {renderInline(row[cIdx] ?? '', `td-${i}-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      elements.push(
        <blockquote
          key={`q-${i}`}
          className="border-l-3 border-blue-500 bg-slate-50 pl-3 pr-2 py-1.5 my-2 rf-body text-xs text-slate-700"
        >
          {quoteLines.map((ql, idx) => (
            <p key={idx}>
              {renderInline(ql, `q-${i}-${idx}`)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc pl-5 my-1.5 space-y-1 rf-body text-xs text-slate-800">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ul-${i}-${idx}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal pl-5 my-1.5 space-y-1 rf-body text-xs text-slate-800">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `ol-${i}-${idx}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Paragraph (group consecutive plain lines until blank or special block)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s+|[-*•]\s+|\d+\.\s+|>\s?|-{3,}$|\*{3,}$)/.test(lines[i].trim()) &&
      !(lines[i].trim().includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    elements.push(
      <p key={`p-${i}`} className="rf-body text-xs text-slate-800 my-1.5">
        {paraLines.map((pl, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(pl, `p-${i}-${idx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className={`space-y-1 break-words ${className}`}>{elements}</div>;
};
