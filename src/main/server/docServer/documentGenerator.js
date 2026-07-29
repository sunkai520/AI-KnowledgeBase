// @ts-ignore
import {
  formatDate,
  getSystemPath
} from "../../utils/common"
import { SettingManager } from '../../utils/settingManager'
const {
  app,
  BrowserWindow
} = require('electron');
const docx = require('docx');
const fs = require('fs-extra');
const path = require('path');
const MarkdownIt = require('markdown-it');

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  Table,
  TableCell,
  TableRow,
  WidthType,
  LevelFormat,
  convertInchesToTwip
} = docx;

// ─── 模板定义 ─────────────────────────────────────────────────────────────────
// 颜色值均不含 # (docx 库要求)；字号单位为半磅 (21 = 10.5pt)；
// lineSpacing: 240=单倍 360=1.5倍 480=双倍；边距单位 twip (1pt=20twip)
const TEMPLATES = {
  business: {
    label: '商务',
    // ── 颜色 ──
    primary:   '1A3A5C', accent:    '2980B9',
    h2Bg:      'E8F0F8', h3Color:   '2C5F8A', h3Border:  'B0C8E8',
    h4Color:   '34495E', h5Color:   '555555', bodyColor: '2D2D2D',
    tblBorder: 'C8D8EA', tblHeader: '1A3A5C', tblEven:   'F0F5FA',
    quoteBg:   'F0F6FC',
    // ── 字体排版 ──
    bodyFont:    'Microsoft YaHei',
    bodySize:    21,   // 10.5pt
    h1Size: 36, h2Size: 28, h3Size: 24, h4Size: 22, h5Size: 20,
    lineSpacing: 360,  // 1.5倍
    paraAfter:   100,
    firstLine:   0,
    // ── 页边距 ──
    margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
    // ── PDF CSS ──
    cssFontFamily: '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
    cssFontSize: '10.5pt', cssLineHeight: '1.85',
  },
  report: {
    label: '报告',
    primary:   '7B1818', accent:    'C0392B',
    h2Bg:      'FFF0EE', h3Color:   '8B2000', h3Border:  'F0B0A0',
    h4Color:   '5C2A00', h5Color:   '6B4040', bodyColor: '1A1A1A',
    tblBorder: 'EEB0A0', tblHeader: '7B1818', tblEven:   'FFF8F6',
    quoteBg:   'FFF3F0',
    bodyFont:    '仿宋',
    bodySize:    22,   // 11pt
    h1Size: 36, h2Size: 28, h3Size: 24, h4Size: 22, h5Size: 20,
    lineSpacing: 480,  // 双倍
    paraAfter:   120,
    firstLine:   440,  // 首行缩进2字符
    margin: { top: 1440, right: 1134, bottom: 1440, left: 1701 }, // 上下2.54cm 右2cm 左3cm装订
    cssFontFamily: '"FangSong","仿宋","SimSun","宋体",serif',
    cssFontSize: '11pt', cssLineHeight: '2.0',
  },
  simple: {
    label: '简约',
    primary:   '2C2C2C', accent:    '888888',
    h2Bg:      'F5F5F5', h3Color:   '444444', h3Border:  'CCCCCC',
    h4Color:   '555555', h5Color:   '777777', bodyColor: '2C2C2C',
    tblBorder: 'CCCCCC', tblHeader: '444444', tblEven:   'F9F9F9',
    quoteBg:   'F7F7F7',
    bodyFont:    '宋体',
    bodySize:    22,   // 11pt
    h1Size: 34, h2Size: 26, h3Size: 24, h4Size: 22, h5Size: 21,
    lineSpacing: 400,  // ~1.67倍
    paraAfter:   120,
    firstLine:   0,
    margin: { top: 1080, right: 1260, bottom: 1080, left: 1260 },
    cssFontFamily: '"宋体","SimSun",serif',
    cssFontSize: '11pt', cssLineHeight: '1.9',
  },
  academic: {
    label: '学术',
    primary:   '1B2A4A', accent:    '3D5A80',
    h2Bg:      'EDF1F7', h3Color:   '1B2A4A', h3Border:  'A0B0CC',
    h4Color:   '2E3E5C', h5Color:   '4A5A7A', bodyColor: '1A1A1A',
    tblBorder: 'A0B4CC', tblHeader: '1B2A4A', tblEven:   'F0F3F8',
    quoteBg:   'F4F6FA',
    bodyFont:    '宋体',
    bodySize:    22,   // 11pt
    h1Size: 34, h2Size: 26, h3Size: 24, h4Size: 22, h5Size: 21,
    lineSpacing: 480,  // 双倍
    paraAfter:   120,
    firstLine:   440,  // 首行缩进2字符
    margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 },
    cssFontFamily: '"Times New Roman","宋体","SimSun",serif',
    cssFontSize: '11pt', cssLineHeight: '2.0',
  },
  intel: {
    label: '情报',
    primary:   '0D1B2A', accent:    'B45309',
    h2Bg:      'FEF3C7', h3Color:   'D97706', h3Border:  'F59E0B',
    h4Color:   '78350F', h5Color:   '92400E', bodyColor: '1A1A1A',
    tblBorder: 'D97706', tblHeader: '1C2D3E', tblEven:   'FFFDF0',
    quoteBg:   'FFFBEB',
    bodyFont:    'Microsoft YaHei',
    bodySize:    21,   // 10.5pt
    h1Size: 36, h2Size: 28, h3Size: 24, h4Size: 22, h5Size: 20,
    lineSpacing: 360,  // 1.5倍
    paraAfter:   100,
    firstLine:   0,
    margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
    cssFontFamily: '"Microsoft YaHei","PingFang SC",sans-serif',
    cssFontSize: '10.5pt', cssLineHeight: '1.85',
  },
};

export const TEMPLATE_LIST = Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label }));

function getTemplate(id) {
  const base = TEMPLATES[id] || TEMPLATES.business;
  try {
    const customizations = SettingManager.getInstance().get('templateCustomizations') || {};
    const delta = customizations[id || 'business'];
    if (delta && typeof delta === 'object') return { ...base, ...delta };
  } catch {}
  return base;
}
// ──────────────────────────────────────────────────────────────────────────────

class DocumentGenerator {
  constructor() {
    const uploadDir = getSystemPath('documents');
    [uploadDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
    console.log(uploadDir, "文档存放目录")
    this.downloadsDir = uploadDir;
    this.md = new MarkdownIt({
      html: true,
      breaks: true,
      linkify: true
    });

    fs.ensureDirSync(this.downloadsDir);
    this.cleanOldFiles(30).catch(console.error);
  }

  generateSafeFilename(baseName) {
    const timestamp = Date.now();
    if (baseName) {
      return baseName.replace(/[^a-zA-Z0-9一-龥_-]/g, '_') + `-${timestamp}`;
    }
    return `doc-${timestamp}`;
  }

  markdownToHtml(markdown, options = {}, tpl = TEMPLATES.business) {
    const content = this.md.render(markdown);
    const h1Pt = Math.round(tpl.h1Size / 2);
    const h2Pt = Math.round(tpl.h2Size / 2);
    const h3Pt = Math.round(tpl.h3Size / 2);
    const h4Pt = Math.round(tpl.h4Size / 2);
    const h5Pt = Math.round(tpl.h5Size / 2);
    const bodyPt = Math.round(tpl.bodySize / 2);
    const paraIndent = tpl.firstLine ? 'text-indent: 2em;' : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${options.title || 'Document'}</title>
  <style>
    @page { margin: 18mm; size: A4; }
    * { box-sizing: border-box; }
    body {
      font-family: ${tpl.cssFontFamily};
      font-size: ${tpl.cssFontSize};
      line-height: ${tpl.cssLineHeight};
      color: #${tpl.bodyColor};
      margin: 0; padding: 0;
    }
    .content { padding: 0; }
    h1 {
      font-size: ${h1Pt}pt; font-weight: 700;
      color: #${tpl.primary}; text-align: center;
      margin: 0 0 6px 0; padding-bottom: 10px;
      border-bottom: 3px solid #${tpl.accent};
      letter-spacing: 1px;
    }
    h2 {
      font-size: ${h2Pt}pt; font-weight: 700;
      color: #${tpl.primary}; margin: 28px 0 8px 0;
      padding: 6px 12px;
      background: linear-gradient(90deg, #${tpl.h2Bg} 0%, #f5f8fc 100%);
      border-left: 4px solid #${tpl.accent};
      border-radius: 0 4px 4px 0;
    }
    h3 {
      font-size: ${h3Pt}pt; font-weight: 700;
      color: #${tpl.h3Color}; margin: 20px 0 6px 0;
      padding-bottom: 4px;
      border-bottom: 1px dashed #${tpl.h3Border};
    }
    h4 {
      font-size: ${h4Pt}pt; font-weight: 700;
      color: #${tpl.h4Color}; margin: 16px 0 4px 0;
    }
    h5 {
      font-size: ${h5Pt}pt; font-weight: 600;
      color: #${tpl.h5Color}; margin: 12px 0 4px 0;
    }
    p { margin: 0 0 8px 0; ${paraIndent} }
    ul, ol { margin: 4px 0 10px 0; padding-left: 24px; }
    li { margin-bottom: 4px; }
    code {
      font-family: "Consolas","Courier New",monospace;
      font-size: 9pt; background: #f0f4f8; color: #c0392b;
      padding: 1px 5px; border-radius: 3px; border: 1px solid #dde5ef;
    }
    pre {
      font-family: "Consolas","Courier New",monospace;
      font-size: 9pt; background: #1e2a3a; color: #e8f0f8;
      padding: 14px 18px; border-radius: 6px;
      overflow-x: auto; margin: 12px 0; line-height: 1.6;
    }
    pre code { background: none; border: none; color: inherit; padding: 0; }
    blockquote {
      border-left: 4px solid #${tpl.accent};
      margin: 12px 0; padding: 8px 16px;
      background: #${tpl.quoteBg}; color: #555;
      font-style: italic; border-radius: 0 4px 4px 0;
    }
    table {
      border-collapse: collapse; width: 100%;
      margin: 14px 0; font-size: ${bodyPt}pt;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
    thead tr { background: #${tpl.tblHeader}; }
    th {
      color: #fff; font-weight: 600;
      padding: 10px 14px; text-align: left;
      border: none; letter-spacing: 0.3px;
    }
    td {
      padding: 9px 14px;
      border-bottom: 1px solid #${tpl.tblBorder};
      border-right: 1px solid #${tpl.tblBorder};
      vertical-align: top;
    }
    tbody tr:nth-child(even) { background: #${tpl.tblEven}; }
    tbody tr:nth-child(odd)  { background: #ffffff; }
    tbody tr:hover { background: rgba(0,0,0,0.03); }
    ${options.customCss || ''}
  </style>
</head>
<body>
  <div class="content">${content}</div>
</body>
</html>`;
  }

  // 解析 Markdown 表格
  parseTable(lines, startIndex) {
    const tableLines = [];
    let i = startIndex;

    while (i < lines.length && lines[i].trim().includes('|')) {
      tableLines.push(lines[i].trim());
      i++;
    }

    if (tableLines.length < 2) return null;

    const headers = tableLines[0]
      .split('|')
      .map(h => h.trim())
      .filter(h => h);

    const dataRows = tableLines.slice(2).map(line =>
      line.split('|')
      .map(cell => cell.trim())
      .filter(cell => cell)
    );

    return {
      headers,
      rows: dataRows,
      nextIndex: i
    };
  }

  parseParagraphs(markdown) {
    const lines = markdown.split('\n');
    const paragraphs = [];
    let i = 0;

    while (i < lines.length) {
      let line = lines[i].trim();
      if (!line) {
        i++;
        continue;
      }

      if (line.includes('|') && line.replace(/\|/g, '').trim()) {
        const tableData = this.parseTable(lines, i);
        if (tableData) {
          paragraphs.push({ type: 'table', headers: tableData.headers, rows: tableData.rows });
          i = tableData.nextIndex;
          continue;
        }
      }

      const processInlineMarkdown = (text) => {
        return text
          .replace(/\*\*(.*?)\*\*/g, '【B】$1【/B】')
          .replace(/\*(.*?)\*/g, '【I】$1【/I】')
          .replace(/`(.*?)`/g, '【CODE】$1【/CODE】');
      };

      if (line.startsWith('# ')) {
        paragraphs.push({ type: 'h1', text: processInlineMarkdown(line.slice(2)) });
      } else if (line.startsWith('## ')) {
        paragraphs.push({ type: 'h2', text: processInlineMarkdown(line.slice(3)) });
      } else if (line.startsWith('### ')) {
        paragraphs.push({ type: 'h3', text: processInlineMarkdown(line.slice(4)) });
      } else if (line.startsWith('#### ')) {
        paragraphs.push({ type: 'h4', text: processInlineMarkdown(line.slice(5)) });
      } else if (line.startsWith('##### ')) {
        paragraphs.push({ type: 'h5', text: processInlineMarkdown(line.slice(6)) });
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        let text = line.slice(2)
          .replace(/\*\*(.*?)\*\*/g, '【B】$1【/B】')
          .replace(/\*(.*?)\*/g, '【I】$1【/I】')
          .replace(/`(.*?)`/g, '【CODE】$1【/CODE】');
        paragraphs.push({ type: 'bullet', text });
      } else if (/^\d+\.\s/.test(line)) {
        let text = line.replace(/^\d+\.\s/, '')
          .replace(/\*\*(.*?)\*\*/g, '【B】$1【/B】')
          .replace(/\*(.*?)\*/g, '【I】$1【/I】')
          .replace(/`(.*?)`/g, '【CODE】$1【/CODE】');
        paragraphs.push({ type: 'numbered', text });
      } else if (line.startsWith('> ')) {
        paragraphs.push({ type: 'quote', text: processInlineMarkdown(line.slice(2)) });
      } else {
        let text = line
          .replace(/\*\*(.*?)\*\*/g, '【B】$1【/B】')
          .replace(/\*(.*?)\*/g, '【I】$1【/I】')
          .replace(/`(.*?)`/g, '【CODE】$1【/CODE】');
        paragraphs.push({ type: 'Text', text });
      }
      i++;
    }

    return paragraphs;
  }

  parseInline(text) {
    return this.styledRuns(text, {});
  }

  styledRuns(text, baseStyle = {}) {
    const parts = text.split(/(【B】.*?【\/B】|【I】.*?【\/I】|【CODE】.*?【\/CODE】)/);
    const runs = [];
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('【B】') && part.endsWith('【/B】')) {
        runs.push(new TextRun({ text: part.slice(3, -4), bold: true, ...baseStyle }));
      } else if (part.startsWith('【I】') && part.endsWith('【/I】')) {
        runs.push(new TextRun({ text: part.slice(3, -4), italics: true, ...baseStyle }));
      } else if (part.startsWith('【CODE】') && part.endsWith('【/CODE】')) {
        runs.push(new TextRun({ text: part.slice(6, -8), font: 'Consolas', size: 20, color: 'e83e8c' }));
      } else {
        runs.push(new TextRun({ text: part, ...baseStyle }));
      }
    }
    return runs.length ? runs : [new TextRun({ text, ...baseStyle })];
  }

  createTableCell(text, isHeader = false, isEvenRow = false, tpl = TEMPLATES.business) {
    const lines = text.split(/<br\s*\/?>/gi);
    const textColor = isHeader ? 'FFFFFF' : undefined;
    const paragraphs = lines.map((line, index) => {
      const boldRegex = /\*\*(.*?)\*\*/g;
      const runs = [];
      let lastIndex = 0;
      let match;
      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex)
          runs.push(new TextRun({ text: line.slice(lastIndex, match.index), color: textColor, size: isHeader ? 20 : 19 }));
        runs.push(new TextRun({ text: match[1], bold: true, color: textColor, size: isHeader ? 20 : 19 }));
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length)
        runs.push(new TextRun({ text: line.slice(lastIndex), color: textColor, size: isHeader ? 20 : 19 }));
      if (runs.length === 0)
        runs.push(new TextRun({ text: line, color: textColor, size: isHeader ? 20 : 19 }));
      return new Paragraph({
        children: runs,
        alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 60, after: 60 }
      });
    });

    const borderDef = { color: tpl.tblBorder, size: 4, style: BorderStyle.SINGLE };
    const fill = isHeader ? tpl.tblHeader : (isEvenRow ? tpl.tblEven : 'FFFFFF');

    return new TableCell({
      children: paragraphs,
      shading: { fill },
      verticalAlign: 'center',
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      borders: {
        top: borderDef, bottom: borderDef,
        left: borderDef, right: borderDef,
      }
    });
  }

  async generatePDF(markdown, filename, options = {}) {
    let win = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1200,
        height: 800,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          offscreen: true
        }
      });

      const tpl = getTemplate(options.templateId);
      const html = this.markdownToHtml(markdown, options, tpl);
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      await new Promise(resolve => setTimeout(resolve, 500));

      const pdfBuffer = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      });

      const outputPath = path.join(this.downloadsDir, `${filename}.pdf`);
      await fs.writeFile(outputPath, pdfBuffer);
      win.close();

      const stats = await fs.stat(outputPath);
      return {
        success: true,
        filename: `${filename}.pdf`,
        path: outputPath,
        size: stats.size,
        format: 'pdf'
      };
    } catch (error) {
      if (win && !win.isDestroyed()) win.close();
      return { success: false, error: error.message };
    }
  }

  async generateWord(markdown, filename, options = {}) {
    try {
      const tpl = getTemplate(options.templateId);
      const paragraphs = this.parseParagraphs(markdown);
      const children = [];
      const bodySpacing = {
        line: tpl.lineSpacing, lineRule: 'auto',
        after: tpl.paraAfter,
      };
      const bodyIndent = tpl.firstLine ? { firstLine: tpl.firstLine } : undefined;

      for (const para of paragraphs) {
        switch (para.type) {
          case 'h1':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { bold: true, size: tpl.h1Size, color: tpl.primary, font: tpl.bodyFont }),
              spacing: { before: 200, after: 300 },
              alignment: AlignmentType.CENTER,
              border: { bottom: { color: tpl.accent, space: 6, style: BorderStyle.SINGLE, size: 18 } }
            }));
            break;
          case 'h2':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { bold: true, size: tpl.h2Size, color: tpl.primary, font: tpl.bodyFont }),
              spacing: { before: 300, after: 160 },
              shading: { fill: tpl.h2Bg },
              border: { left: { color: tpl.accent, space: 8, style: BorderStyle.SINGLE, size: 28 } },
              indent: { left: 160 }
            }));
            break;
          case 'h3':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { bold: true, size: tpl.h3Size, color: tpl.h3Color, font: tpl.bodyFont }),
              spacing: { before: 220, after: 120 },
              border: { bottom: { color: tpl.h3Border, space: 2, style: BorderStyle.DASHED, size: 4 } }
            }));
            break;
          case 'h4':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { bold: true, size: tpl.h4Size, color: tpl.h4Color }),
              spacing: { before: 180, after: 100 }
            }));
            break;
          case 'h5':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { bold: true, size: tpl.h5Size, color: tpl.h5Color }),
              spacing: { before: 140, after: 80 }
            }));
            break;
          case 'bullet':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { size: tpl.bodySize, color: tpl.bodyColor, font: tpl.bodyFont }),
              spacing: bodySpacing,
              bullet: { level: 0 }
            }));
            break;
          case 'numbered':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { size: tpl.bodySize, color: tpl.bodyColor, font: tpl.bodyFont }),
              spacing: bodySpacing,
              numbering: { reference: 'numbers', level: 0 }
            }));
            break;
          case 'quote':
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { italics: true, color: '555555', size: tpl.bodySize }),
              spacing: { before: 120, after: 120 },
              shading: { fill: tpl.quoteBg },
              indent: { left: 560 },
              border: { left: { color: tpl.accent, space: 10, style: BorderStyle.SINGLE, size: 24 } }
            }));
            break;
          case 'table': {
            const tableRows = [];
            tableRows.push(new TableRow({
              children: para.headers.map(h => this.createTableCell(h, true, false, tpl)),
              tableHeader: true
            }));
            for (let ri = 0; ri < para.rows.length; ri++) {
              tableRows.push(new TableRow({
                children: para.rows[ri].map(cell => this.createTableCell(cell, false, ri % 2 === 1, tpl))
              }));
            }
            const borderDef = { color: tpl.tblBorder, size: 4, style: BorderStyle.SINGLE };
            children.push(new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: borderDef, bottom: borderDef,
                left: borderDef, right: borderDef,
                insideHorizontal: borderDef, insideVertical: borderDef
              }
            }));
            children.push(new Paragraph({ text: '', spacing: { after: 120 } }));
            break;
          }
          default:
            children.push(new Paragraph({
              children: this.styledRuns(para.text, { size: tpl.bodySize, color: tpl.bodyColor, font: tpl.bodyFont }),
              spacing: bodySpacing,
              ...(bodyIndent ? { indent: bodyIndent } : {}),
              alignment: AlignmentType.JUSTIFIED
            }));
        }
      }

      const doc = new Document({
        numbering: {
          config: [
            {
              reference: 'numbers',
              levels: [{
                level: 0,
                format: LevelFormat.DECIMAL,
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: { indent: { left: convertInchesToTwip(0.4), hanging: convertInchesToTwip(0.2) } }
                }
              }]
            },
            {
              reference: 'bullets',
              levels: [{
                level: 0,
                format: LevelFormat.BULLET,
                text: '•',
                alignment: AlignmentType.LEFT,
                style: {
                  paragraph: { indent: { left: convertInchesToTwip(0.4), hanging: convertInchesToTwip(0.2) } }
                }
              }]
            }
          ]
        },
        sections: [{
          properties: {
            page: { margin: tpl.margin }
          },
          children
        }]
      });

      const outputPath = path.join(this.downloadsDir, `${filename}.docx`);
      const buffer = await Packer.toBuffer(doc);
      await fs.writeFile(outputPath, buffer);

      const stats = await fs.stat(outputPath);
      return {
        success: true,
        filename: `${filename}.docx`,
        path: outputPath,
        size: stats.size,
        format: 'docx'
      };
    } catch (error) {
      console.error('Word generation error:', error);
      return { success: false, error: error.message };
    }
  }

  async generate(markdown, format, filename, options) {
    const safeName = this.generateSafeFilename(filename);
    if (format === 'pdf') {
      return this.generatePDF(markdown, safeName, options);
    } else {
      return this.generateWord(markdown, safeName, options);
    }
  }

  async getFileList() {
    const files = await fs.readdir(this.downloadsDir);
    const list = [];
    for (const file of files) {
      const filePath = path.join(this.downloadsDir, file);
      const stat = await fs.stat(filePath);
      list.push({
        name: file,
        size: stat.size,
        created: stat.birthtime,
        modified: stat.mtime
      });
    }
    return list.sort((a, b) => b.created - a.created);
  }

  async getFilePath(filename) {
    const filePath = path.join(this.downloadsDir, filename);
    if (await fs.pathExists(filePath)) return filePath;
    return null;
  }

  async deleteFile(filename) {
    const filePath = path.join(this.downloadsDir, filename);
    await fs.remove(filePath);
  }

  async cleanOldFiles(days = 30) {
    const now = Date.now();
    const maxAge = days * 24 * 60 * 60 * 1000;
    const deletedFiles = [];
    try {
      const files = await fs.readdir(this.downloadsDir);
      for (const file of files) {
        const filePath = path.join(this.downloadsDir, file);
        const stat = await fs.stat(filePath);
        const fileAge = now - stat.mtime.getTime();
        if (fileAge > maxAge) {
          await fs.remove(filePath);
          deletedFiles.push(file);
          console.log(`[清理] 删除过期文件: ${file} (${Math.floor(fileAge / 86400000)}天前)`);
        }
      }
      if (deletedFiles.length > 0) console.log(`[清理完成] 共删除 ${deletedFiles.length} 个过期文件`);
      return { deleted: deletedFiles.length, files: deletedFiles };
    } catch (error) {
      console.error('[清理错误]', error);
      return { deleted: 0, files: [], error: error.message };
    }
  }

  async cleanAllFiles() {
    try {
      const files = await fs.readdir(this.downloadsDir);
      for (const file of files) {
        const filePath = path.join(this.downloadsDir, file);
        await fs.remove(filePath);
      }
      console.log(`[清空完成] 共删除 ${files.length} 个文件`);
      return { deleted: files.length };
    } catch (error) {
      console.error('[清空错误]', error);
      return { deleted: 0, error: error.message };
    }
  }
}

export default new DocumentGenerator();
