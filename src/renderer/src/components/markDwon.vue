<template>
  <div ref="body"></div>
  <!-- 复制成功提示 -->
  <transition name="fade">
    <div v-if="showToast" class="copy-toast">已复制到剪贴板</div>
  </transition>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";
// 浅色主题
//import "highlight.js/styles/github.css";
// 深色主题
//import "highlight.js/styles/atom-one-dark.css";
// 经典暗色
//import "highlight.js/styles/monokai.css";
// 夜猫子主题
//import "highlight.js/styles/night-owl.css";
const props = defineProps({
  content: { type: String, default: "" },
  isStreaming: { type: Boolean, default: false },
});

const body = ref();
const showToast = ref(false);
let toastTimer = null;

// 配置 marked
marked.setOptions({
  highlight: function (code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch (e) {}
    }
    return hljs.highlightAuto(code).value;
  },
  langPrefix: "hljs language-",
});

// #6: 流式输出期间用 RAF 批量更新，每帧最多解析一次，避免长文末尾掉帧
const renderContent = ref(props.content);
const html = computed(() => marked.parse(renderContent.value));
let rafId = null;

// 图片/视频闪动的根因：以前用 v-html 整段替换 innerHTML，每次流式追加文字都会把整个 DOM 子树推倒重建，
// 已经加载好的 <img>/<video> 节点也被销毁重建，浏览器只能重新拉取/重新解码一遍，表现为闪动。
// 流式追加只会往后面接新内容，前面已经生成完的段落（含图片/视频所在的段落，因为后端插入时前后都带了空行，
// marked 会把它们解析成独立的顶层块）在后续每次重新解析时 outerHTML 是完全一样的——
// 所以只需要按顶层块逐个比较，没变的原地跳过，只替换真正变化的那一小块（通常就是末尾还在增长的那段），
// 不需要引入通用 DOM diff 库。
function patchDom() {
  if (!body.value) return;
  const temp = document.createElement("div");
  temp.innerHTML = html.value;
  const oldNodes = Array.from(body.value.children);
  const newNodes = Array.from(temp.children);
  const max = Math.max(oldNodes.length, newNodes.length);
  for (let i = 0; i < max; i++) {
    const oldNode = oldNodes[i];
    const newNode = newNodes[i];
    if (!newNode) {
      oldNode.remove();
    } else if (!oldNode) {
      body.value.appendChild(newNode);
    } else if (oldNode.outerHTML !== newNode.outerHTML) {
      oldNode.replaceWith(newNode);
    }
    // outerHTML 相同：跳过，保留原节点（图片/视频不会被重建，也就不会闪）
  }
}

// 复制到剪贴板
const copyToClipboard = async (text, btn) => {
  try {
    await navigator.clipboard.writeText(text);
    showFeedback(btn, true);
    showToastMsg();
  } catch (err) {
    // 降级方案
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showFeedback(btn, true);
      showToastMsg();
    } catch (e) {
      showFeedback(btn, false);
    }
    document.body.removeChild(textarea);
  }
};

// 显示按钮反馈
const showFeedback = (btn, success) => {
  const originalHTML = btn.innerHTML;
  btn.innerHTML = success
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
    : `✕`;
  btn.style.color = success ? "#3ecf8e" : "#ff4d4f";
  btn.classList.add("copied");

  setTimeout(() => {
    btn.innerHTML = originalHTML;
    btn.style.color = "";
    btn.classList.remove("copied");
  }, 2000);
};

// 显示全局提示
const showToastMsg = () => {
  showToast.value = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    showToast.value = false;
  }, 2000);
};

// 添加复制按钮到代码块
const addCopyButtons = () => {
  if (!body.value) return;

  const pres = body.value.querySelectorAll("pre");
  pres.forEach((pre) => {
    // 避免重复添加
    if (pre.querySelector(".copy-btn")) return;

    const code = pre.querySelector("code");
    if (!code) return;

    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>复制</span>
    `;

    btn.addEventListener("click", () => {
      const text = code.textContent || code.innerText;
      copyToClipboard(text, btn);
    });

    pre.appendChild(btn);
  });
};

let highlightTimer = null;
const highlightCode = (forceRun = false) => {
  if (props.isStreaming && !forceRun) return;
  nextTick(() => {
    const blocks = body.value?.querySelectorAll("pre code");
    blocks?.forEach((block) => hljs.highlightElement(block));
    addCopyButtons();
  });
};

onMounted(() => {
  renderContent.value = props.content;
  patchDom();
  highlightCode();
});

watch(() => props.content, (val) => {
  if (props.isStreaming) {
    // 流式期间：合并到下一帧再解析，跳过中间帧的重复请求
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      renderContent.value = props.content;
      patchDom();
      rafId = null;
    });
  } else {
    renderContent.value = val;
    patchDom();
    highlightCode();
  }
});

watch(() => props.isStreaming, (streaming) => {
  if (!streaming) {
    // 流结束：取消挂起的 RAF，同步到最终内容后再高亮
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    renderContent.value = props.content;
    patchDom();
    highlightCode(true);
  }
});
</script>

<style scoped lang="scss">
:deep(pre) {
  position: relative;
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  margin: 1em 0;

  code {
    white-space: pre-wrap;
    word-wrap: break-word;
    font-family: "SF Mono", Monaco, Consolas, monospace;
    font-size: 14px;
    line-height: 1.6;
    background: transparent;
    padding: 0;
    color: #d4d4d4;
  }

  // 复制按钮样式
  .copy-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    color: #999;
    font-size: 12px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s;
    backdrop-filter: blur(4px);

    &:hover {
      background: rgba(255, 255, 255, 0.2);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.3);
    }

    &.copied {
      background: rgba(62, 207, 142, 0.2);
      border-color: rgba(62, 207, 142, 0.3);
    }

    svg {
      pointer-events: none;
    }
  }

  // Hover 时显示按钮
  &:hover .copy-btn {
    opacity: 1;
  }
}

:deep(h1) {
  line-height: 40px;
}
:deep(h2) {
  line-height: 30px;
}
:deep(table) {
  border-collapse: collapse; /* 合并边框 */
  width: 100%; /* 表格宽度 */
  max-width: 1200px; /* 最大宽度 */
  margin: 20px auto; /* 上下20px，左右自动（居中） */
  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); /* 阴影效果 */
}
:deep(thead) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); /* 渐变背景 */
  color: white;
}
:deep(th) {
  padding: 15px 20px;
  text-align: center; /* 水平居中 */
  vertical-align: middle; /* 垂直居中 */
  font-weight: 600;
  font-size: 14px;
  border: 1px solid #5a67d8; /* 表头边框 */
  letter-spacing: 0.5px;
}
/* 表格主体样式 */
:deep(td) {
  padding: 12px 20px;
  text-align: center; /* 水平居中 */
  vertical-align: middle; /* 垂直居中 */
  border: 1px solid #e2e8f0; /* 单元格边框 */
  font-size: 14px;
  color: #2d3748;
}

/* 斑马纹效果（隔行变色） */
:deep(tbody tr:nth-child(even)) {
  background-color: #f7fafc;
}

:deep(tbody tr:nth-child(odd)) {
  background-color: #ffffff;
}

/* 鼠标悬停效果 */
:deep(tbody tr:hover) {
  background-color: #edf2f7;
  transition: background-color 0.3s ease;
}

/* 空单元格样式 */
:deep(td:empty) {
  background-color: #f1f5f9;
}
:deep(img){
  max-width: 100%;
}
// 复制成功提示
.copy-toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.8);
  color: white;
  padding: 10px 20px;
  border-radius: 20px;
  font-size: 14px;
  z-index: 9999;
  backdrop-filter: blur(10px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>