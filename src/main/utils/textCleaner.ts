// textCleaner.js - 无需 JSDOM，Electron 100%兼容
export class TextCleaner {
    static stripHtml(html) {
      if (!html) return '';
      return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
        .replace(/\n\s*\n/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }
  
    static stripMarkdown(md) {
      if (!md) return '';
      let text = md;
  
      // 代码块
      text = text.replace(/```[\s\S]*?```/g, '');
      text = text.replace(/`([^`]+)`/g, '$1');
  
      // 标题修复：# 后面可以没有空格，直接跟文字
      // 匹配行首的 1-6 个 #，后面可选空格，然后捕获文字
      text = text.replace(/^#{1,6}\s*/gm, '');
  
      // 粗体斜体
      text = text.replace(/\*\*\*(.*?)\*\*\*/g, '$1');
      text = text.replace(/\*\*(.*?)\*\*/g, '$1');
      text = text.replace(/\*(.*?)\*/g, '$1');
      text = text.replace(/___(.*?)___/g, '$1');
      text = text.replace(/__(.*?)__/g, '$1');
      text = text.replace(/_(.*?)_/g, '$1');
  
      // 链接和图片
      text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
  
      // 引用块
      text = text.replace(/^>\s*/gm, '');
  
      // 无序列表
      text = text.replace(/^[-*+]\s*/gm, '');
  
      // 有序列表
      text = text.replace(/^\d+\.\s*/gm, '');
  
      // 水平线
      text = text.replace(/^[-*_]{3,}\s*$/gm, '');
  
      // 表格
      text = text.replace(/\|/g, ' ');
      text = text.replace(/^\s*[-:]+\s*$/gm, '');
  
      // HTML 标签
      text = text.replace(/<[^>]+>/g, '');
  
      // 转义字符
      text = text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
  
      return this.normalizeWhitespace(text);
    }
    static normalizeWhitespace(text) {
      return text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        .trim();
    }
    static cleanAll(content) {
      return this.stripMarkdown(this.stripHtml(content));
    }
  }
  
