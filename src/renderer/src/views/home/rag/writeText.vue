<template>
  <div class="withespace">
    <div ref="editorRef" style="height: 100%">
      <div class="aie-container" style="background-color: #f3f4f6">
        <!-- 顶部工具栏 -->
        <div class="aie-header-panel">
          <div class="aie-container-header" style="background: #fff;"></div>
          <div v-if="isReadOnly" class="export-icon-group">
            <!-- 导出PDF：文件+三条横线 -->
            <div class="export-icon-btn" title="导出PDF" @click="exportPdf">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
                <line x1="8" y1="15" x2="16" y2="15"/>
                <line x1="8" y1="18" x2="12" y2="18"/>
              </svg>
            </div>
            <!-- 导出Word：文件+W字形折线 -->
            <div class="export-icon-btn" title="导出Word" @click="exportWord">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <polyline points="8 12 10 18 12 14 14 18 16 12"/>
              </svg>
            </div>
          </div>
        </div>

        <!-- 主体区域 -->
        <div class="aie-main">
          <!-- 左侧文档目录 -->
          <div
            :class="
              outline && outline.length > 0
                ? 'aie-directory-content'
                : 'noneDirectoryContent'
            "
          >
            <div class="aie-directory">
              <h5>文档目录</h5>
              <div id="outline">
                <div
                  v-for="(item, index) in outline"
                  :key="index"
                  :class="[
                    'aie-title' + item.level,
                    { active: activeHeading === item.id },
                  ]"
                  :style="{ marginLeft: item.level * 5 + 'px' }"
                  @click="scrollToHeading(item, index)"
                >
                  <a href="javascript:void(0)">{{ item.text }}</a>
                </div>
              </div>
            </div>
          </div>

          <!-- 右侧编辑区域 -->
          <div class="aie-container-panel">
            <div class="aie-container-main" id="contentEditor"></div>
          </div>
        </div>
        <!-- 底部 -->
        <div class="aie-container-footer">
          <div
            style="
              display: flex;
              justify-content: flex-end;
              font-size: 12px;
              color: #999;
              padding: 5px;
            "
          >
            <span>字数:{{ charCount }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, computed } from "vue";
import { AiEditor } from "aieditor";
import { imageSetting, videoSetting, fileSetting } from "./aiEditorSetting";
import "aieditor/dist/style.css";
import { ElMessage } from "element-plus";
import { debounce } from "@renderer/utils/common";
import { delUpload } from "@renderer/api/index";
import { textDetail, updateText } from "@renderer/api/text";
import router from "../../../router";

// ==================== 响应式数据 ====================
const toolbarRef = ref(null);
const editorRef = ref(null);
const isReadOnly = ref(false);
const aiEditor = ref(null);
const outline = ref([]);
const activeHeading = ref("");
const charCount = ref(0);
const oldUrls = ref([]);
const textInfo = ref({});
const isComposing = ref(false);
// ==================== 编辑器初始化 ====================
const initEditor = async () => {
  if (!editorRef.value) return;
  isReadOnly.value = router.currentRoute.value.query.isRead == 1;
  const editToolbarKeys = [
    "undo",
    "redo",
    "brush",
    "eraser",
    "|",
    "heading",
    "font-family",
    "font-size",
    "highlight",
    "font-color",
    "container",
    "code-block",
    "|",
    "bold",
    "italic",
    "underline",
    "strike",
    "align",
    "subscript",
    "superscript",
    "quote",
    "code",
    "hr",
    "ordered-list",
    "todo",
    "emoji",
    "|",
    "break",
    "link",
    "indent-decrease",
    "indent-increase",
    "image",
    "video",
    "attachment",
    "quote",
    "table",
    "|",
    "printer",
    "fullscreen",
    "ai",
    {
      html: "<div><div class='save'><span>保存</span></div></div>",
      onClick: async (event, editor) => {
        console.log(editor.getMarkdown(), "editor");
        let rr = await updateText({
          content: editor.getHtml(),
          id: textInfo.value.id,
          markdownContent: editor.getMarkdown(),
        });
        router.go(-1);
        ElMessage.success("保存成功");
      },
      tip: "保存",
    },
  ];
  aiEditor.value = new AiEditor({
    element: editorRef.value,
    // contentIsMarkdown: true,
    toolbarExcludeKeys: ["brush"],
    toolbarKeys: isReadOnly.value ? ["printer", "fullscreen"] : editToolbarKeys,
    // 内容配置
    content: textInfo.value.content,

    draggable: false,
    contentRetention: true,
    placeholder: "请输入内容，Ctrl+s 保存",
    editable: !isReadOnly.value,
    // AI 配置
    ai: {
      models: {
        custom: {
          url: "http://localhost:5120/text/aiText",

          headers: () => {
            return {
              "Content-Type": "application/json", // 关键：声明发送 JSON
            };
          },
          protocol: "sse",
          wrapPayload: (message) => {
            let promt = `${message}/\n/\n1.我只要新扩写的内容，其他内容一概不要,切记思考过程请不要返回。/\n/\n 2.如果过你不清楚怎么写，请告知我原因。`;
            console.log(promt, "mmmm");
            return { prompt: promt };
          },

          parseMessage: (message) => {
            console.log(message, "message");
            const cleanMessage = message.replace(/^data:\s*/, "");
            return {
              role: "assistant",
              content: cleanMessage,
              // index: number,
              // //0 代表首个文本结果；1 代表中间文本结果；2 代表最后一个文本结果。
              // status: 0|1|2,
            };
          },
          // protocol: "sse"
        },
      },
    },
    image: imageSetting,
    video: videoSetting,
    attachment: fileSetting,
    // 事件监听
    onChange: (editor) => {
      charCount.value = editor.getText?.().length || 0;
      if (isComposing.value) return;
      nextTick(() => {
        updateOutlineFromDOM();
        let jsond = editor.getJson();
        if (jsond && jsond.type === "doc") {
          handelCompareFiles(jsond.content);
        }
      });
    },
    onDestroy: (editor) => {
      console.log("AIEditor 被销毁了....");
      localStorage.removeItem("ai-editor-content");
    },
    onSave: async (editor) => {
      //通过这里进行保存的逻辑操作
      // console.log(editor.getMarkdown(), "editor");
      let rr = await updateText({
        content: editor.getHtml(),
        id: textInfo.value.id,
        markdownContent: editor.getMarkdown(),
      });
      router.go(-1);
      ElMessage.success("保存成功");
    },
  });

  // 监听 IME 合成状态，防止拼音字母被提前写入编辑器
  editorRef.value.addEventListener("compositionstart", () => { isComposing.value = true; });
  editorRef.value.addEventListener("compositionend", () => { isComposing.value = false; });

  // 初始化后等待 DOM 更新
  nextTick(() => {
    setTimeout(() => {
      updateOutlineFromDOM();
      setupScrollListener();
      console.log(aiEditor.value, "===");
      let jsond = aiEditor.value.getJson();
      if (jsond && jsond.type === "doc") {
        handelCompareFiles(jsond.content);
      }
      // 初始化字符数
      charCount.value = aiEditor.value?.getText?.().length || 0;
    }, 500);
  });
};

// ==================== 从 DOM 提取目录 ====================
const updateOutlineFromDOM = () => {
  const proseMirror = document.querySelector(".aie-container-main");

  if (!proseMirror) {
    console.log("未找到编辑器内容");
    return;
  }

  const headings = proseMirror.querySelectorAll("h1, h2, h3, h4, h5, h6");
  console.log("找到标题数量:", headings.length);

  if (headings.length === 0) {
    outline.value = [];
    return;
  }

  // 清除旧 ID，使用 aie-heading-xxx 格式
  headings.forEach((h) => {
    // 保留已有的 aie-heading- 开头的 ID
    if (!h.id || !h.id.startsWith("aie-heading-")) {
      h.removeAttribute("id");
    }
  });

  // 构建目录
  outline.value = Array.from(headings).map((heading, index) => {
    const id = `aie-heading-${index + 1}`;
    heading.id = id;
    console.log(heading.offsetTop, "offsetTop");
    return {
      id: id,
      text: heading.textContent.trim() || "无标题",
      level: parseInt(heading.tagName[1]),
      dom: heading,
      top: heading.offsetTop,
    };
  });

  console.log(
    "目录:",
    outline.value.map((o) => o.text)
  );
};

// ==================== 点击定位 ====================
const scrollToHeading = (item, index) => {
  const target = item.dom;
  if (!target) {
    return;
  }
  // 找到可滚动的容器
  const scrollContainer = document.querySelector(".aie-content");
  console.log(scrollContainer, "scrollContainer");
  if (!scrollContainer) return;
  // 计算目标位置
  const containerRect = scrollContainer.getBoundingClientRect();
  const targetRect = item.top;
  // 滚动到目标位置
  scrollContainer.scrollTo({
    top: targetRect,
    behavior: "smooth",
  });

  activeHeading.value = index;
};

// ==================== 滚动监听 ====================
const setupScrollListener = () => {
  const scrollContainer = document.querySelector(".aie-container-main > div");
  if (!scrollContainer) return;
  const handleScroll = () => {
    const headings = document.querySelectorAll('[id^="aie-heading-"]');
    if (headings.length === 0) return;
    const scrollTop = scrollContainer.scrollTop + 50;

    let currentId = "";
    for (let heading of headings) {
      if (heading.offsetTop <= scrollTop) {
        currentId = heading.id;
      } else {
        break;
      }
    }

    if (currentId && activeHeading.value !== currentId) {
      activeHeading.value = currentId;
    }
  };

  scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
};
// 递归遍历文档树，收集所有层级（含 blockquote/列表/表格/container 等嵌套块）中的图片、视频 src 和链接 href
const collectFileUrls = (nodes, urls) => {
  if (!Array.isArray(nodes)) return;
  nodes.forEach((item) => {
    if (!item) return;
    // 提取 image 和 video 的 src
    if ((item.type === "image" || item.type === "video") && item.attrs && item.attrs.src) {
      urls.push(item.attrs.src);
    }
    if (Array.isArray(item.content)) {
      // 提取 content 里文本节点 marks 中的 href
      item.content.forEach((contentItem) => {
        if (contentItem.marks && Array.isArray(contentItem.marks)) {
          contentItem.marks.forEach((mark) => {
            if (mark.type === "link" && mark.attrs && mark.attrs.href) {
              urls.push(mark.attrs.href);
            }
          });
        }
      });
      // 递归进入嵌套块（blockquote、列表、表格、container 等）
      collectFileUrls(item.content, urls);
    }
  });
};
const handelCompareFiles = debounce((data) => {
  const urls = [];
  collectFileUrls(data, urls);
  oldUrls.value.forEach((u) => {
    if (!urls.includes(u)) {
      removeFile(u);
    }
  });
  oldUrls.value = urls;
});
function removeFile(url) {
  console.log(url, "被移除了");
  const regex = /\/uploads\/([^/]+)\/([^/]+)$/;
  const match = url.match(regex);
  if (match) {
    const folder = match[1]; // "images"
    const fileName = match[2]; // "file-1770687183703-541783285.png"
    console.log(folder, fileName);
    delUpload(folder, fileName);
  }
}
// ==================== 导出功能 ====================
const exportPdf = async () => {
  try {
    const content = document.querySelector(".ProseMirror");
    if (!content) {
      ElMessage.error("未找到文档内容");
      return;
    }
    ElMessage.info("正在生成PDF，请稍候...");
    const html2pdf = (await import("html2pdf.js")).default;
    const opt = {
      margin: 10,
      filename: `${textInfo.value.title || "文档"}.pdf`,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    };
    await html2pdf().set(opt).from(content).save();
    ElMessage.success("PDF导出成功");
  } catch (e) {
    console.error("PDF导出失败", e);
    ElMessage.error("PDF导出失败: " + e.message);
  }
};

const exportWord = () => {
  try {
    const htmlContent = aiEditor.value?.getHtml() || "";
    if (!htmlContent) {
      ElMessage.error("文档内容为空");
      return;
    }
    const docName = textInfo.value.title || "文档";
    const wordDoc = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${docName}</title><style>body{font-family:微软雅黑,Arial;font-size:12pt;}h1{font-size:18pt;}h2{font-size:16pt;}h3{font-size:14pt;}table{border-collapse:collapse;}td,th{border:1px solid #ccc;padding:4px;}</style></head><body>${htmlContent}</body></html>`;
    const blob = new Blob(["﻿", wordDoc], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docName}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    ElMessage.success("Word导出成功");
  } catch (e) {
    console.error("Word导出失败", e);
    ElMessage.error("Word导出失败: " + e.message);
  }
};

// ==================== 生命周期 ====================
onMounted(() => {
  if (router.currentRoute.value.query.id) {
    textDetail(router.currentRoute.value.query.id).then((r) => {
      textInfo.value = r.data;
      setTimeout(initEditor, 0);
      // initEditor();
    });
  }

  // aiEditor.value.setMarkdownContent(str);
});

onUnmounted(() => {
  if (aiEditor.value) {
    aiEditor.value.destroy();
    aiEditor.value = null;
  }
});
</script>



<style scoped lang="scss">
:deep(.save) {
  cursor: pointer;
  background-color: #2563eb;
  color: white;
  font-size: 14px;
  padding: 2px 5px;
  border-radius: 5px;
}
:deep(.inject-export-btn) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  color: #374151;
  &:hover {
    background: #e5e7eb;
    color: #2563eb;
  }
}
.withespace {
  width: 100%;
  height: 100%;
  border-radius: 10px;
  padding: 10px;
  overflow: hidden;
  background: white;
}
.aie-theme-light {
  height: 100%;
  width: 100%;
}
/* 主题根容器 */
#aiEditor {
  height: 100vh;
  overflow: hidden;
}

/* 主容器 */
.aie-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* 顶部工具栏面板 */
.aie-header-panel {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}
.export-icon-group {
  display: flex;
  align-items: center;
  padding: 0 4px;
  gap: 2px;
  flex-shrink: 0;
}
.export-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  color: #374151;
  &:hover {
    background: #e5e7eb;
    color: #2563eb;
  }
}

.aie-container-header {
  border-bottom: 1px solid #e5e7eb;
}

/* 主体区域 - 横向布局 */
.aie-main {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧文档目录 */
.aie-directory-content {
  width: 200px;
  flex-shrink: 0;
  background: #fafafa;
  border-right: 1px solid #e5e7eb;
  overflow-y: auto;
  transition: width 0.2s;
}
.noneDirectoryContent {
  width: 0; /* 目标宽度 */
  transition: width 0.2s;
}
.aie-directory {
  padding: 16px;
}

.aie-directory h5 {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #374151;
}

/* 目录项样式 */
.aie-title1,
.aie-title2,
.aie-title3,
.aie-title4,
.aie-title5,
.aie-title6 {
  margin: 4px 0;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.5;
  transition: all 0.2s;
}

.aie-title1 a,
.aie-title2 a,
.aie-title3 a,
.aie-title4 a,
.aie-title5 a,
.aie-title6 a {
  color: #6b7280;
  text-decoration: none;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aie-title1:hover,
.aie-title2:hover,
.aie-title3:hover,
.aie-title4:hover,
.aie-title5:hover,
.aie-title6:hover {
  background: #e5e7eb;
}

.aie-title1.active,
.aie-title2.active,
.aie-title3.active,
.aie-title4.active,
.aie-title5.active,
.aie-title6.active {
  background: #dbeafe;
}

.aie-title1.active a,
.aie-title2.active a,
.aie-title3.active a,
.aie-title4.active a,
.aie-title5.active a,
.aie-title6.active a {
  color: #2563eb;
  font-weight: 500;
}

/* 右侧编辑区域 */
.aie-container-panel {
  height: 100%;
  width: 100%;
}
.aie-container-main {
  height: 100%;
  width: 100%;
  overflow: auto;
  background: white;
  :deep(> div) {
    width: 100%;
    box-sizing: border-box;
    height: 100%;
    > div {
      height: 100% !important;
      box-sizing: border-box;
      padding: 10px !important;
    }
  }
}

/* 编辑器内容样式覆盖 */
:deep(.ProseMirror) {
  outline: none;
  padding: 20px;
  min-height: 100%;
  background: #fff;
}

:deep(.ProseMirror h1) {
  font-size: 28px;
  font-weight: 600;
  // margin: 24px 0 16px;
  color: #111827;
}

:deep(.ProseMirror h2) {
  font-size: 24px;
  font-weight: 600;
  // margin: 20px 0 12px;
  color: #1f2937;
}

:deep(.ProseMirror h3) {
  font-size: 20px;
  font-weight: 600;
  // margin: 16px 0 8px;
  color: #374151;
}

:deep(.ProseMirror p) {
  margin: 8px 0;
  line-height: 1.5;
  color: #374151;
}

:deep(.ProseMirror pre) {
  background: #f3f4f6;
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
}

/* 底部 */
.aie-container-footer {
  flex-shrink: 0;
  background: #fff;
  border-top: 1px solid #e5e7eb;
  :deep(aie-footer) {
    display: none;
  }
}
</style>