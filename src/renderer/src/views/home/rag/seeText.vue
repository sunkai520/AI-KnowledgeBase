<template>
  <div class="seeText">
    <div class="content">
      <div
        class="aie-content rich-content"
        v-html="textInfo.content"
        ref="contentRef"
      ></div>
    </div>
  </div>
</template>

<script setup>
import { textDetail } from "@renderer/api/text";
import { onMounted, ref, nextTick, watch } from "vue";
import router from "../../../router";
import hljs from "highlight.js";
import "highlight.js/styles/github-dark.css";

const textInfo = ref({});
const contentRef = ref(null);

const highlightCode = () => {
  nextTick(() => {
    if (!contentRef.value) return;
    contentRef.value.querySelectorAll("pre code").forEach((block) => {
      hljs.highlightElement(block);
    });
  });
};

onMounted(() => {
  if (router.currentRoute.value.query.id) {
    textDetail(router.currentRoute.value.query.id).then((r) => {
      textInfo.value = r.data;
      highlightCode();
    });
  }
});

watch(() => textInfo.value.content, highlightCode);
</script>

<style lang="scss" scoped>
.seeText {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 20px;

  .content {
    width: 85%;
    border-radius: 16px;
    padding: 30px 40px;
    margin: auto;
    box-shadow: 0 10px 30px #ffffff4f, inset 0 1px 0 #ffffff4f;
    background-color: #1a1a1a;
  }
}

/* 覆盖 AiEditor 在暗色背景下的样式 */
:deep(.rich-content) {
  color: #e0e0e0;
  font-size: 15px;
  line-height: 1.8;

  h1, h2, h3, h4, h5, h6 {
    color: #ffffff;
    margin: 1em 0 0.5em;
  }

  p {
    margin: 0.6em 0;
  }

  strong, b {
    color: #ffffff;
  }

  a {
    color: #64b5f6;
  }

  blockquote {
    border-left: 4px solid #555;
    margin: 1em 0;
    padding: 0.5em 1em;
    color: #aaa;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 0 6px 6px 0;
  }

  ul, ol {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  li {
    margin: 0.3em 0;
  }

  pre {
    position: relative;
    background: #1e1e1e;
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    margin: 1em 0;

    code {
      font-family: "SF Mono", Monaco, Consolas, monospace;
      font-size: 14px;
      line-height: 1.6;
      background: transparent;
      padding: 0;
      color: #d4d4d4;
    }
  }

  code:not(pre code) {
    background: rgba(255, 255, 255, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    color: #e06c75;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    margin: 1em 0;
    font-size: 14px;

    th {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 10px 16px;
      text-align: left;
      border: 1px solid #5a67d8;
    }

    td {
      padding: 10px 16px;
      border: 1px solid #444;
      color: #e0e0e0;
    }

    tbody tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.04);
    }

    tbody tr:hover {
      background: rgba(255, 255, 255, 0.08);
    }
  }

  img {
    max-width: 100%;
    border-radius: 6px;
  }

  hr {
    border: none;
    border-top: 1px solid #444;
    margin: 1.5em 0;
  }
}
</style>