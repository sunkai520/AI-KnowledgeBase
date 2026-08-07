import {
  Router,
  Request,
  Response
} from 'express';
import {
  success,
  error500,
  error
} from "../responseFn"
import documentGenerator from './documentGenerator';
import { extractDocxStyleTemplate } from '../../utils/docStyleExtractor';

const router = Router();

/**
 * POST /doc/generate
 * 生成 Word 或 PDF 文档
 * 
 * Body: {
 *   markdown: string,      // Markdown 内容（必填）
 *   format: 'pdf' | 'word', // 格式（必填）
 *   filename?: string,      // 自定义文件名（可选）
 *   options?: {            // 生成选项（可选）
 *     title?: string,
 *     headerText?: string,
 *     customCss?: string
 *   }
 * }
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      markdown,
      format,
      filename,
      options = {}
    } = req.body;

    // 参数验证
    if (!markdown) {
      return res.status(400).json(error500('缺少 markdown 内容'));
    }
    if (!format || !['pdf', 'word', 'docx'].includes(format)) {
      return res.status(400).json(error500('格式必须是 pdf 或 word'));
    }

    // 生成文档
    const result = await documentGenerator.generate(
      markdown,
      format === 'docx' ? 'word' : format,
      filename,
      options
    );

    if (!result.success) {
      return res.status(500).json(error500(result.error));
    }

    // 构建下载 URL（复用你现有的 5120 端口）
    const downloadUrl = `http://localhost:5120/doc/download/${result.filename}`;

    return res.json(success({
      downloadUrl,
      filename: result.filename,
      size: result.size,
      format: result.format,
      path: result.path
    }));

  } catch (error) {
    console.error('[文档生成错误]', error);
    return res.status(500).json(error500(error.message || '文档生成失败'));
  }
});

/**
 * POST /doc/parseStyleTemplate
 * 从一份参考 .docx 里提取标题/节标题/正文的字体、字号、缩进、行距,
 * 供 /doc/generate 的 options.customTemplate 使用,实现"复刻参考文档格式"导出。
 *
 * Body: { filePath: string }  // 本地磁盘路径,渲染进程通过 window.electronAPI.selectFile() 选文件后拿到
 */
router.post('/parseStyleTemplate', async (req, res) => {
  try {
    const { filePath, fileName } = req.body;
    if (!filePath) {
      return res.status(400).json(error500('缺少 filePath'));
    }
    const tpl = await extractDocxStyleTemplate(filePath, fileName);
    if (!tpl) {
      return res.status(422).json(error500('未能从该文档识别出可用的段落格式,请确认是未加密的 .docx 文件'));
    }
    return res.json(success(tpl));
  } catch (error) {
    console.error('[样式提取错误]', error);
    return res.status(500).json(error500(error.message || '样式提取失败'));
  }
});

/**
 * GET /doc/download/:filename
 * 下载生成的文档
 */
router.get('/download/:filename', async (req, res) => {
  try {
    const {
      filename
    } = req.params;
    const filePath = await documentGenerator.getFilePath(filename);

    if (!filePath) {
      return res.status(404).json(error500('文件不存在'));
    }

    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('[下载错误]', err);
        res.status(500).json(error500('下载失败'));
      }
    });

  } catch (error) {
    return res.status(500).json(error500(error.message));
  }
});

/**
 * GET /doc/list
 * 获取生成的文档列表
 */
router.get('/list', async (req, res) => {
  try {
    const files = await documentGenerator.getFileList();
    return res.json(success(files));
  } catch (error) {
    return res.status(500).json(error500(error.message));
  }
});

/**
 * DELETE /doc/delete/:filename
 * 删除指定文档
 */
router.delete('/delete/:filename', async (req, res) => {
  try {
    const {
      filename
    } = req.params;
    await documentGenerator.deleteFile(filename);
    return res.json(success({
      deleted: filename
    }));
  } catch (error) {
    return res.status(500).json(error500(error.message));
  }
});
// POST /doc/clean - 清理旧文档（默认30天）
router.post('/clean', async (req, res) => {
  try {
    const {
      days = 30
    } = req.body;
    const result = await documentGenerator.cleanOldFiles(days);
    return res.json(success(result));
  } catch (error) {
    return res.status(500).json(error500(error.message));
  }
});

// POST /doc/clean-all - 清空所有文档（危险操作）
router.post('/clean-all', async (req, res) => {
  try {
    const result = await documentGenerator.cleanAllFiles();
    return res.json(success(result));
  } catch (error) {
    return res.status(500).json(error500(error.message));
  }
});
export default router;
