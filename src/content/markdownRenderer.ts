import { escapeHtml } from "./htmlEscape";

// 轻量 Markdown 渲染器：仅覆盖正文视图需要的子集（标题/列表/引用/代码块/行内样式/链接）。
// 不做完整 CommonMark 解析——正文来源是受控的（GitHub/Reddit/Discourse/X 原生 Markdown + 通用提取），
// 渲染器只负责把结构元素映射为语义 HTML，交由 CSS 呈现。

function inline(text: string): string {
  let t = escapeHtml(text);
  // 行内代码（先处理，避免内部标记被二次处理）
  t = t.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);
  // 链接 [text](url)
  t = t.replace(/\[([^[\]]+)\]\(([^()\s]+)\)/g, (_m, label: string, url: string) => {
    const safeUrl = /^https?:\/\//i.test(url) ? url : "#";
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  // 加粗 **text**
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 斜体 *text*
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return t;
}

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  let inCode = false;
  let codeBuf: string[] = [];
  let para: string[] = [];

  function flushPara(): void {
    if (para.length) {
      out.push(`<p>${para.map(inline).join("<br/>")}</p>`);
      para = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // 代码块
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flushPara();
      if (inCode) {
        out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) {
      flushPara();
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 分隔线
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      out.push("<hr/>");
      i++;
      continue;
    }

    // 引用块
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const block: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        block.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${block.map(inline).join("<br/>")}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      out.push("<ul>");
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^\s*[-*+]\s+/, ""))}</li>`);
        i++;
      }
      out.push("</ul>");
      continue;
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara();
      out.push("<ol>");
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        out.push(`<li>${inline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        i++;
      }
      out.push("</ol>");
      continue;
    }

    // 空行 → 段落结束
    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    // 普通段落行
    para.push(line);
    i++;
  }
  flushPara();
  if (inCode) {
    out.push(`<pre><code>${codeBuf.join("\n")}</code></pre>`);
  }
  return out.join("\n");
}