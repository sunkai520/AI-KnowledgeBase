<template>
  <div class="ai-doc-dialog" v-loading="pageLoading">
    <aside class="sidebar">
      <div class="sidebar-header">
        <div>
          <div class="sidebar-title">写作会话</div>
          <div class="sidebar-subtitle">{{ profileInfo.title || "个人写作" }}</div>
        </div>
      </div>

      <div class="chat-list">
        <div
          v-for="(chat, idx) in chats"
          :key="chat.id"
          :class="['chat-item glow', { active: currentChatIndex === idx }]"
          @click="selectChat(idx)"
        >
          <el-avatar size="24" :class="chat.role">
            <el-icon><ChatLineRound /></el-icon>
          </el-avatar>
          <div class="chat-preview">{{ chat.preview || "新写作会话" }}</div>
          <el-icon
            class="delete-session"
            color="#ef4444"
            size="16"
            @click.stop="deleteChat(idx)"
          >
            <Delete />
          </el-icon>
        </div>
      </div>

      <el-button
        type="primary"
        class="new-chat-btn glow"
        :disabled="loading"
        @click="createNewChat"
      >
        新建会话
      </el-button>
    </aside>

    <main class="chat-panel glow-panel">
      <header class="header">
        <div class="header-left">
          <el-icon size="20" color="#38bdf8"><Document /></el-icon>
          <span>AI 写作助手</span>
        </div>
      </header>

      <section ref="listRef" class="bubble-list" @scroll="handleListScroll">
        <div
          v-for="(msg, idx) in currentMessages"
          :key="idx"
          :class="['bubble', msg.role, 'glow']"
        >
          <div class="ai" v-if="msg.role === 'ai'">
            <el-avatar :size="24" :class="msg.role">
              <el-icon><ChatLineRound /></el-icon>
            </el-avatar>
            <div style="flex: 1">
              <div v-if="msg.steps && msg.steps.length" class="steps-wrap">
                <template v-if="msg.thinking">
                  <div class="steps-running">
                    <template v-for="(step, si) in msg.steps" :key="si">
                      <div :class="['step-item', step.status]">
                        <span class="step-dot"></span>
                        <span class="step-name">{{ step.displayName }}</span>
                        <span
                          v-if="step.status === 'done' && (step.results?.length || step.kbResults?.length || step.parseResult)"
                          class="step-expand-btn"
                          @click.stop="step.expanded = !step.expanded"
                        >
                          {{ step.expanded ? "收起" : "展开" }}
                        </span>
                      </div>
                      <div v-if="step.expanded && step.results?.length" class="search-results">
                        <a
                          v-for="(r, ri) in step.results"
                          :key="ri"
                          :href="r.url"
                          target="_blank"
                          class="search-result-card"
                        >
                          <div class="sr-title">{{ r.title }}</div>
                          <div class="sr-meta"><span class="sr-source">{{ r.source || r.url }}</span></div>
                          <div v-if="r.snippet" class="sr-snippet">{{ r.snippet }}</div>
                        </a>
                      </div>
                      <div v-if="step.expanded && step.kbResults?.length" class="kb-results">
                        <div v-for="(r, ri) in step.kbResults" :key="ri" class="kb-result-card">
                          <div class="kb-head">
                            <span class="kb-badge">知识 {{ r.index }}</span>
                            <span v-if="r.source" class="kb-source">{{ r.source }}</span>
                            <span v-if="r.similarity != null" class="kb-sim">相似度 {{ r.similarity }}%</span>
                          </div>
                          <div class="kb-content">{{ stripHtml(r.content) }}</div>
                        </div>
                      </div>
                      <div v-if="step.expanded && step.parseResult" class="parse-result">
                        <div class="pr-header">
                          <a :href="step.parseResult.url" target="_blank" class="pr-title">
                            {{ step.parseResult.title || step.parseResult.url }}
                          </a>
                          <span class="pr-url">{{ step.parseResult.url }}</span>
                        </div>
                        <div class="pr-content" v-html="step.parseResult.markdown"></div>
                      </div>
                    </template>
                  </div>
                </template>
                <template v-else>
                  <div class="steps-summary" @click="msg.stepsExpanded = !msg.stepsExpanded">
                    <span class="steps-toggle">{{ msg.stepsExpanded ? "▾" : "▸" }}</span>
                    已执行 {{ msg.steps.length }} 个步骤
                  </div>
                  <div v-if="msg.stepsExpanded" class="steps-done-list">
                    <template v-for="(step, si) in msg.steps" :key="si">
                      <div class="step-done-item">
                        <span class="step-check">✓</span>
                        <span>{{ step.displayName }}</span>
                        <span
                          v-if="step.results?.length || step.kbResults?.length || step.parseResult"
                          class="step-expand-btn"
                          @click.stop="step.expanded = !step.expanded"
                        >
                          {{ step.expanded ? "收起" : "展开" }}
                        </span>
                      </div>
                      <div v-if="step.expanded && step.results?.length" class="search-results">
                        <a
                          v-for="(r, ri) in step.results"
                          :key="ri"
                          :href="r.url"
                          target="_blank"
                          class="search-result-card"
                        >
                          <div class="sr-title">{{ r.title }}</div>
                          <div class="sr-meta"><span class="sr-source">{{ r.source || r.url }}</span></div>
                          <div v-if="r.snippet" class="sr-snippet">{{ r.snippet }}</div>
                        </a>
                      </div>
                      <div v-if="step.expanded && step.kbResults?.length" class="kb-results">
                        <div v-for="(r, ri) in step.kbResults" :key="ri" class="kb-result-card">
                          <div class="kb-head">
                            <span class="kb-badge">知识 {{ r.index }}</span>
                            <span v-if="r.source" class="kb-source">{{ r.source }}</span>
                            <span v-if="r.similarity != null" class="kb-sim">相似度 {{ r.similarity }}%</span>
                          </div>
                          <div class="kb-content">{{ stripHtml(r.content) }}</div>
                        </div>
                      </div>
                      <div v-if="step.expanded && step.parseResult" class="parse-result">
                        <div class="pr-header">
                          <a :href="step.parseResult.url" target="_blank" class="pr-title">
                            {{ step.parseResult.title || step.parseResult.url }}
                          </a>
                          <span class="pr-url">{{ step.parseResult.url }}</span>
                        </div>
                        <div class="pr-content" v-html="step.parseResult.markdown"></div>
                      </div>
                    </template>
                  </div>
                </template>
              </div>

              <div class="thinking" v-if="msg.thinking && !msg.steps?.length">
                思考中<span>.</span><span>.</span><span>.</span>
              </div>
              <div
                class="thinking"
                v-else-if="msg.thinking && msg.steps?.length && msg.steps.every((step) => step.status === 'done')"
              >
                写作中<span>.</span><span>.</span><span>.</span>
              </div>
              <div class="thinking thinking-sm" v-else-if="msg.thinking && msg.steps?.length">
                执行中<span>.</span><span>.</span><span>.</span>
              </div>

              <div class="content markdown-content" v-if="msg.content">
                <MarkDwon
                  :content="msg.content"
                  :isStreaming="idx === currentMessages.length - 1 && loading"
                />
                <div class="options">
                  <div class="copy" @click="copy(msg.content)">
                    <el-icon><CopyDocument /></el-icon>
                    <span>复制</span>
                  </div>
                  <div class="copy" @click="exportMessageWord(msg)">
                    <el-icon><Download /></el-icon>
                    <span>导出Word</span>
                  </div>
                </div>
                <div v-if="msg.feedbackVisible" class="feedback-card">
                  <div class="feedback-head">
                    <div>
                      <div class="feedback-title">这版写得怎么样？</div>
                      <div class="feedback-subtitle">
                        评分和修改意见会进入反馈样本池，用于后续提炼画像候选规则。
                      </div>
                    </div>
                    <el-tag size="small" class="feedback-score-tip">1-10 分</el-tag>
                  </div>
                  <div class="feedback-rate-row">
                    <el-rate
                      v-model="msg.feedbackScore"
                      :max="10"
                      show-score
                      :disabled="msg.feedbackSubmitted"
                      text-color="#0f766e"
                      score-template="{value} 分"
                    />
                  </div>
                  <el-input
                    v-model="msg.feedbackText"
                    class="feedback-input"
                    type="textarea"
                    :rows="2"
                    resize="none"
                    :disabled="msg.feedbackSubmitted"
                    placeholder="如果需要修改，可以写：更口语一点、短一点、别那么正式、结尾更有力..."
                  />
                  <div class="feedback-actions">
                    <span v-if="msg.feedbackSubmitted" class="feedback-saved-tip">反馈已保存</span>
                    <el-button
                      class="feedback-btn"
                      size="small"
                      :loading="msg.feedbackSaving"
                      :disabled="msg.feedbackSubmitted"
                      @click="submitFeedback(msg, false)"
                    >
                      保存反馈
                    </el-button>
                    <el-button
                      class="feedback-btn primary"
                      size="small"
                      type="primary"
                      :loading="msg.feedbackSaving"
                      :disabled="msg.feedbackSubmitted"
                      @click="submitFeedback(msg, true)"
                    >
                      按反馈修改
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else>
            <MessageAttachments :files="msg.files" />
            <div class="humanUser">
              <div class="right">
                <div class="content">{{ msg.content }}</div>
                <el-avatar :size="24" :class="msg.role">
                  <el-icon><UserFilled /></el-icon>
                </el-avatar>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 回到底部：用户往上翻看历史时出现，点击后跳到最新内容并恢复自动跟随 -->
      <transition name="scroll-btn-fade">
        <div v-if="showScrollBtn" class="scroll-bottom-btn" @click="scrollBottom(true)">
          <el-icon><Bottom /></el-icon>
        </div>
      </transition>

      <footer class="footer">
        <AiInput
          class="aiInput"
          :writeId="currentProfileId"
          :loading="loading"
          :showInternetToggle="false"
          :showSampleSelect="true"
          :sampleOptions="sampleOptions"
          @componentParams="handleSend"
          @stop="stopGeneration"
        />
      </footer>
    </main>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import {
  Bottom,
  ChatLineRound,
  CopyDocument,
  Delete,
  Document,
  Download,
  UserFilled,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { marked } from "marked";
import AiInput from "@renderer/components/aiInput.vue";
import MessageAttachments from "@renderer/components/messageAttachments.vue";
import MarkDwon from "@renderer/components/markDwon.vue";
import { copyText } from "@renderer/utils/common";
import { detail } from "@renderer/api/writeStyle";
import {
  createWritingChatSession,
  createWritingFeedback,
  deleteWritingChatSession,
  getWritingChatMessages,
  listWritingChatSessions,
} from "@renderer/api/text";
import router from "../../../router";

const AI_ENDPOINT = "http://localhost:5120/text/aiText";
const route = useRoute();

const pageLoading = ref(false);
const loading = ref(false);
const profileInfo = ref({});
const chats = ref([]);
const currentChatIndex = ref(0);
const listRef = ref(null);
const showScrollBtn = ref(false);
let abortController = null;
let scrollTimer = null;

const currentMessages = computed(() => chats.value[currentChatIndex.value]?.messages || []);
const currentProfileId = computed(() => Number(profileInfo.value?.id) || 0);
const sampleOptions = computed(() => profileInfo.value?.samples || []);
const htmlDecoder = document.createElement("textarea");

function buildWelcomeMessage() {
  const title = profileInfo.value?.title || "你的写作画像";
  return `你好，我会按「${title}」来帮你写。你可以直接说主题、用途、语气和长度，也可以贴一段内容让我改写。`;
}

function createChat(options = {}) {
  const {
    sessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    preview = "新写作会话",
    messages = null,
  } = options;
  return {
    id: sessionId,
    sessionId,
    role: "ai",
    preview,
    messages: messages || [{ role: "ai", content: buildWelcomeMessage() }],
  };
}

async function createNewChat() {
  if (loading.value) {
    ElMessage.warning("当前正在生成，请先停止或等待完成");
    return;
  }
  if (!profileInfo.value?.id) return;

  try {
    const res = await createWritingChatSession({
      profileId: profileInfo.value.id,
      name: "新写作会话",
    });
    const chat = createChat({ sessionId: res.data.sessionId });
    chats.value.push(chat);
    currentChatIndex.value = chats.value.length - 1;
    scrollBottom(true);
  } catch (err) {
    ElMessage.error(err.message || "创建写作会话失败");
  }
}

async function selectChat(idx) {
  if (idx === currentChatIndex.value) return;
  if (loading.value) {
    ElMessage.warning("生成中暂时不能切换会话，请等待完成或点击停止");
    return;
  }
  currentChatIndex.value = idx;
  await loadChatMessages(chats.value[idx]);
  scrollBottom(true);
}

async function deleteChat(idx) {
  if (loading.value) {
    ElMessage.warning("生成中暂时不能删除会话");
    return;
  }
  try {
    await ElMessageBox.confirm("确定删除这个写作会话吗？", "删除会话", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  const removed = chats.value[idx];
  if (removed?.sessionId) {
    await deleteWritingChatSession(removed.sessionId);
  }
  chats.value.splice(idx, 1);
  if (!chats.value.length) {
    await createNewChat();
    return;
  }
  currentChatIndex.value = Math.max(0, Math.min(currentChatIndex.value, chats.value.length - 1));
  await loadChatMessages(chats.value[currentChatIndex.value]);
}

function copy(text) {
  copyText(text || "");
  ElMessage.success("已复制");
}

function exportMessageWord(msg) {
  if (!msg?.content) {
    ElMessage.warning("暂无可导出的内容");
    return;
  }
  try {
    const htmlContent = marked.parse(msg.content || "");
    const docName = profileInfo.value.title || "AI写作";
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
    ElMessage.error("Word导出失败：" + e.message);
  }
}

function stripHtml(html) {
  if (!html) return "";
  let text = String(html).replace(/<[^>]+>/g, " ");
  htmlDecoder.innerHTML = text;
  text = htmlDecoder.value;
  return text.replace(/\s+/g, " ").trim();
}

function isNearBottom() {
  if (!listRef.value) return true;
  const { scrollTop, scrollHeight, clientHeight } = listRef.value;
  return scrollHeight - scrollTop - clientHeight < 80;
}

function scrollBottom(immediate = false) {
  if (immediate) {
    nextTick(() => {
      if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight;
      showScrollBtn.value = false;
    });
    return;
  }
  if (!isNearBottom() || scrollTimer) return;
  scrollTimer = requestAnimationFrame(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight;
    scrollTimer = null;
  });
}

// 监听消息列表滚动，用户往上翻看历史时显示"回到底部"按钮
function handleListScroll() {
  showScrollBtn.value = !isNearBottom();
}

function stopGeneration() {
  if (!abortController) return;
  abortController.abort();
  abortController = null;
  loading.value = false;
  const lastMsg = currentMessages.value[currentMessages.value.length - 1];
  if (lastMsg?.role === "ai") {
    lastMsg.thinking = false;
    if (!lastMsg.content) lastMsg.content = "（已停止生成）";
  }
}

function friendlyError(raw = "") {
  if (/unexpected item type in content|invalid.*content.*type|image_url.*not.*support|does not support.*image/i.test(raw)) return "当前模型不支持图片输入，请更换支持视觉的模型后重试，或不要上传图片";
  if (/429|quota|rate.?limit|billing/i.test(raw)) return "API 配额不足或请求过于频繁，请检查账号余额后重试";
  if (/401|unauthorized|invalid.?key/i.test(raw)) return "API Key 无效，请前往模型配置页面检查";
  if (/403|forbidden/i.test(raw)) return "无权限访问该模型，请检查 API Key 或套餐";
  if (/404|not.?found|does not exist|no access/i.test(raw)) return "模型不存在或无访问权限，请前往模型配置页面确认模型名称";
  if (/5\d\d|internal.?error|server.?error/i.test(raw)) return "模型服务异常，请稍后重试";
  if (/timeout|timed.?out/i.test(raw)) return "请求超时，请稍后重试";
  if (/network|connect/i.test(raw)) return "网络连接失败，请检查网络后重试";
  return raw || "未知错误，请稍后重试";
}

function upsertToolResult(message, event) {
  const steps = [...(message.steps || [])];
  const reverseIndex = [...steps].reverse().findIndex((step) => step.tool === event.toolName);
  if (reverseIndex === -1) return;
  const index = steps.length - 1 - reverseIndex;
  const currentStep = steps[index];

  if (event.toolName === "webSearch") {
    steps[index] = { ...currentStep, results: event.results };
  } else if (
    event.toolName === "searchLocalKB" ||
    event.toolName === "writingProfile" ||
    event.toolName === "writingMemory"
  ) {
    steps[index] = { ...currentStep, kbResults: event.results };
  } else if (event.toolName === "parseWebPage") {
    steps[index] = { ...currentStep, parseResult: event.parseResult };
  }

  message.steps = steps;
}

function applyStreamEvent(message, event) {
  if (event.type === "error") {
    const msg = friendlyError(event.error || event.content);
    message.content = `❌ ${msg}`;
    message.loading = false;
    message.thinking = false;
    loading.value = false;
    ElMessage.error({ message: msg, duration: 5000 });
    return;
  }

  if (event.type === "tool_start") {
    message.steps = [
      ...(message.steps || []),
      {
        tool: event.toolName,
        displayName: event.displayName || event.toolName,
        status: "running",
        expanded: false,
      },
    ];
    return;
  }

  if (event.type === "tool_done") {
    const steps = [...(message.steps || [])];
    const reverseIndex = [...steps].reverse().findIndex(
      (step) => step.status === "running" && (!event.toolName || step.tool === event.toolName)
    );
    if (reverseIndex !== -1) {
      const index = steps.length - 1 - reverseIndex;
      steps[index] = { ...steps[index], status: "done" };
      message.steps = steps;
    }
    return;
  }

  if (event.type === "tool_result") {
    upsertToolResult(message, event);
    return;
  }

  if (event.content) {
    message.content += event.content;
    message.tools = event.tool;
    if (typeof event.content === "string" && event.content.trim()) {
      message.loading = false;
      message.thinking = false;
    }
  }
}

function parseStreamEvent(payload) {
  if (!payload || payload === "DONE" || payload === "[DONE]") return null;
  try {
    return JSON.parse(payload);
  } catch {
    return { content: payload };
  }
}

async function submitFeedback(message, revise = false) {
  if (!message?.content || message.feedbackSaving) return;
  if (message.feedbackSubmitted) {
    ElMessage.info("这条反馈已经保存过了");
    return;
  }
  if (!message.feedbackScore) {
    ElMessage.warning("请先给这版内容打个分");
    return;
  }
  const feedbackText = String(message.feedbackText || "").trim();
  if (revise && !feedbackText) {
    ElMessage.warning("请先写一下希望怎么修改");
    return;
  }

  const chat = chats.value[currentChatIndex.value];
  message.feedbackSaving = true;
  message.feedbackSubmitting = true;
  try {
    await createWritingFeedback({
      profileId: currentProfileId.value,
      sessionId: chat?.sessionId || "",
      userPrompt: message.feedbackPrompt || "",
      aiDraft: message.content,
      userFeedback: feedbackText,
      score: message.feedbackScore,
      accepted: !revise && Number(message.feedbackScore) >= 8,
    });
    message.feedbackSubmitted = true;
    message.feedbackVisible = !revise;
    ElMessage.success(revise ? "反馈已保存，正在按你的意见修改" : "反馈已保存");

    if (revise) {
      await sendMessage({
        question: `请根据我的反馈修改上一版文章：${feedbackText}`,
      });
    }
  } catch (err) {
    ElMessage.error(err.message || "保存反馈失败");
    message.feedbackSubmitting = false;
  } finally {
    message.feedbackSaving = false;
  }
}

function normalizeSessionPreview(text = "") {
  const clean = stripHtml(text).trim();
  return clean ? clean.slice(0, 28) : "新写作会话";
}

function mapPersistedMessage(item) {
  return {
    role: item.role === "assistant" ? "ai" : item.role,
    content: item.content || "",
    files: item.files,
  };
}

async function loadChatMessages(chat) {
  if (!chat?.sessionId) return;
  try {
    const res = await getWritingChatMessages(chat.sessionId);
    const messages = (res.data || []).map(mapPersistedMessage).filter((item) => item.content);
    chat.messages = messages.length ? messages : [{ role: "ai", content: buildWelcomeMessage() }];
  } catch (err) {
    ElMessage.error(err.message || "加载写作会话失败");
  }
}

async function loadWritingSessions(profileId) {
  const res = await listWritingChatSessions({ profileId });
  const sessions = res.data || [];
  chats.value = sessions.map((item) =>
    createChat({
      sessionId: item.sessionId,
      preview: normalizeSessionPreview(item.preview || item.name),
      messages: [{ role: "ai", content: buildWelcomeMessage() }],
    })
  );

  if (!chats.value.length) {
    await createNewChat();
    return;
  }

  currentChatIndex.value = 0;
  await loadChatMessages(chats.value[0]);
}

async function handleSend(data) {
  await sendMessage(data);
}

async function sendMessage(data) {
  const question = String(data.question || "").trim();
  if (!question || loading.value || !profileInfo.value?.id) return;

  const chat = chats.value[currentChatIndex.value];
  if (!chat?.sessionId) return;
  chat.preview = question.slice(0, 28) || "写作会话";
  chat.messages.push({
    role: "user",
    content: question,
    files: data.uploadedDocs?.map((item) => item.filePath).join(","),
  });
  chat.messages.push({
    role: "ai",
    content: "",
    loading: true,
    thinking: true,
    tools: "",
    steps: [],
    stepsExpanded: false,
    feedbackPrompt: question,
    feedbackVisible: false,
    feedbackScore: 0,
    feedbackText: "",
    feedbackSaving: false,
    feedbackSubmitting: false,
    feedbackSubmitted: false,
  });
  loading.value = true;
  abortController = new AbortController();
  scrollBottom(true);

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: question,
        themeId: profileInfo.value.id,
        sessionId: chat.sessionId,
        streamEvents: true,
        selectedSampleIds: data.selectedSampleIds || [],
        uploadedDocs: data.uploadedDocs || [],
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      throw new Error("写作请求失败，请检查模型配置后重试");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";
    const aiMsg = chat.messages[chat.messages.length - 1];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = parseStreamEvent(line.slice(6).trim());
        if (!event) continue;
        applyStreamEvent(aiMsg, event);
        scrollBottom();
      }
    }

    if (lineBuffer.startsWith("data: ")) {
      const event = parseStreamEvent(lineBuffer.slice(6).trim());
      if (event) applyStreamEvent(chat.messages[chat.messages.length - 1], event);
    }

    const lastMsg = chat.messages[chat.messages.length - 1];
    lastMsg.thinking = false;
    if (!lastMsg.content) lastMsg.content = "没有收到有效内容，请换个说法再试一次。";
    if (lastMsg.content && !lastMsg.content.startsWith("没有收到有效内容")) {
      lastMsg.feedbackVisible = true;
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    const lastMsg = chat.messages[chat.messages.length - 1];
    lastMsg.thinking = false;
    lastMsg.content = `请求失败：${err.message || "请稍后重试"}`;
    ElMessage.error(err.message || "写作请求失败");
  } finally {
    loading.value = false;
    abortController = null;
    scrollBottom(); // 回答结束时也只在用户贴底时才跟随，避免打断往上翻看
  }
}

async function loadProfile() {
  const id = route.query.id;
  if (!id) {
    ElMessage.warning("请先选择一个写作画像");
    router.push("/home/writeStyle");
    return;
  }

  pageLoading.value = true;
  try {
    const res = await detail(id);
    profileInfo.value = { ...(res.data || {}), id: res.data?.id || Number(id) };
    await loadWritingSessions(profileInfo.value.id || id);
  } catch (err) {
    ElMessage.error(err.message || "加载写作画像失败");
    router.push("/home/writeStyle");
  } finally {
    pageLoading.value = false;
    scrollBottom(true);
  }
}

onMounted(loadProfile);

onUnmounted(() => {
  if (abortController) abortController.abort();
  if (scrollTimer) cancelAnimationFrame(scrollTimer);
});
</script>

<style scoped lang="scss">
.ai-doc-dialog {
  height: 100%;
  display: flex;
  gap: 0;
  box-sizing: border-box;
  background: #f8fafc;
  overflow: hidden;
}

.glow,
.glow-panel {
  box-shadow: none;
}

.sidebar {
  width: 240px;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 10px;
  background: linear-gradient(180deg, #f8fafc, #eef2f7);
  border-right: 1px solid rgba(15, 23, 42, 0.06);
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sidebar-title {
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
}

.sidebar-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}

.chat-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding-right: 4px;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 14px;
  cursor: pointer;
  background: transparent;
  border: 1px solid transparent;
  transition: 0.18s ease;
}

.chat-item:hover,
.chat-item.active {
  background: rgba(56, 189, 248, 0.12);
}

.chat-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.delete-session {
  opacity: 0;
  transition: 0.18s ease;
}

.chat-item:hover .delete-session {
  opacity: 1;
}

.new-chat-btn {
  margin: 0 6px;
  border-radius: 16px;
}

.chat-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
  overflow: hidden;
  position: relative;
}

.header {
  flex: 0 0 auto;
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 0 12px;
}

.header-left,
.header-title {
  font-size: 18px;
  font-weight: 800;
  color: #0f172a;
}

.bubble-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px;
  overflow-y: auto;
}

.scroll-bottom-btn {
  position: absolute;
  bottom: 150px;
  right: 32px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(56, 189, 248, 0.92);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.25);
  cursor: pointer;
  z-index: 5;
  transition: transform 0.2s ease;
}
.scroll-bottom-btn:hover {
  transform: translateY(-2px);
}
.scroll-btn-fade-enter-active,
.scroll-btn-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.scroll-btn-fade-enter-from,
.scroll-btn-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.bubble {
  border-radius: 16px;
  padding: 20px;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
  box-shadow:
    0 10px 30px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

:deep(.el-avatar.ai) {
  background: #38bdf8;
}

:deep(.el-avatar.user) {
  background: #0f766e;
}

.thinking span {
  animation: blink 1.2s infinite;
}

.thinking span:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
}

.options {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  margin-top: 10px;
}

.footer {
  flex: 0 0 auto;
  padding: 10px;
  margin-top: 12px;
  width: 100%;
  height: auto;
  box-sizing: border-box;
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid #c9dbf3;
}

.aiInput {
  width: 100%;
}

.markdown-content :deep(img) { max-width: 100%; height: auto; border-radius: 8px; }
.markdown-content :deep(a) { color: #0369a1; text-decoration: underline; word-break: break-all; }
.markdown-content :deep(table) { border-collapse: collapse; width: 100%; font-size: 12px; margin: 8px 0; }
.markdown-content :deep(th),
.markdown-content :deep(td) { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; }
.markdown-content :deep(th) { background: #f1f5f9; font-weight: 700; }
.markdown-content :deep(p) { margin: 4px 0; }
.markdown-content :deep(ul),
.markdown-content :deep(ol) { padding-left: 20px; margin: 4px 0; }
.markdown-content :deep(pre),
.markdown-content :deep(code) { background: #f1f5f9; border-radius: 6px; font-size: 12px; }
.markdown-content :deep(pre) { padding: 8px 12px; overflow-x: auto; }

/* === 与 AI 助手页统一的视觉覆盖 === */
.ai-doc-dialog {
  display: flex;
  width: 95%;
  height: 90vh;
  margin: 20px auto;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
  box-shadow: 0 10px 30px #00e7ff, inset 0 1px 0 #00e7ff;
  font-family: "Helvetica Neue", Arial, sans-serif;
}

.sidebar {
  width: 220px;
  min-width: 220px;
  border-right: 1px solid rgba(15, 23, 42, 0.06);
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #f8fafc, #eef2f7);
  padding: 16px 0;
}

.sidebar-header {
  padding: 0 16px;
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 12px;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.sidebar-subtitle {
  display: none;
}

.chat-list {
  padding: 0 5px;
  flex: 1;
  overflow-y: auto;
  gap: 0;
}

.chat-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  gap: 8px;
  cursor: pointer;
  border-radius: 16px;
  transition: all 0.35s ease;
  position: relative;
  background: transparent;
  border: none;
}

.chat-item.active,
.chat-item:hover {
  background: rgba(56, 189, 248, 0.12);
}

.chat-preview {
  flex: 1;
  font-size: 14px;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 400;
}

.delete-session {
  display: none;
  opacity: 1;
}

.chat-item:hover .delete-session {
  display: block;
}

.new-chat-btn {
  margin: 12px 16px;
  border-radius: 16px;
}

.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
}

.header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #0f172a;
  padding: 0;
  min-height: auto;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
}

.header-subtitle {
  display: none;
}

.bubble-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px;
}

.bubble {
  border-radius: 16px;
  padding: 20px;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
  box-shadow:
    0 10px 30px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition: all 0.35s ease;
  position: relative;
}

.bubble .ai {
  display: flex;
}

.bubble .copy {
  cursor: pointer;
  display: flex;
  align-items: center;
}

.bubble .copy span {
  margin-left: 5px;
}

.bubble .options {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
}

.feedback-card {
  margin: 14px 0 0 10px;
  padding: 16px;
  border: 1px solid #bfdbfe;
  border-radius: 16px;
  background:
    radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), transparent 42%),
    linear-gradient(180deg, #ffffff, #f8fbff);
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
}

.feedback-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.feedback-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.feedback-subtitle {
  margin-top: 3px;
  font-size: 12px;
  color: #64748b;
}

.feedback-rate-row {
  margin-bottom: 10px;
}

.feedback-score-tip {
  color: #0369a1 !important;
  background: #e0f2fe !important;
  border-color: #bae6fd !important;
  border-radius: 999px;
  font-weight: 600;
}

.feedback-input {
  display: block;
}

.feedback-input :deep(.el-textarea__inner) {
  min-height: 72px !important;
  padding: 11px 13px !important;
  color: #0f172a !important;
  background: #ffffff !important;
  border: 1px solid #cbd5e1 !important;
  border-radius: 12px !important;
  box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.04) !important;
  line-height: 1.6 !important;
}

.feedback-input :deep(.el-textarea__inner::placeholder) {
  color: #94a3b8 !important;
}

.feedback-input :deep(.el-textarea__inner:hover) {
  border-color: #93c5fd !important;
}

.feedback-input :deep(.el-textarea__inner:focus) {
  border-color: #38bdf8 !important;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.14) !important;
}

.feedback-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.feedback-saved-tip {
  margin-right: auto;
  color: #059669;
  font-size: 12px;
  font-weight: 600;
}

.feedback-btn {
  color: #0369a1 !important;
  background: #ffffff !important;
  border-color: #bae6fd !important;
  border-radius: 10px !important;
  font-weight: 600;
}

.feedback-btn:hover {
  color: #0284c7 !important;
  background: #f0f9ff !important;
  border-color: #7dd3fc !important;
}

.feedback-btn.primary {
  color: #ffffff !important;
  background: linear-gradient(135deg, #38bdf8, #0ea5e9) !important;
  border-color: #38bdf8 !important;
}

.feedback-btn.primary:hover {
  background: linear-gradient(135deg, #0ea5e9, #0284c7) !important;
}

.bubble .humanUser {
  display: flex;
  justify-content: flex-end;
}

.bubble .humanUser .right {
  display: flex;
}

.bubble .humanUser .right .content {
  margin-right: 10px;
  color: blue;
  font-weight: 600;
}

.tools,
.files {
  font-size: 14px;
  color: grey;
  padding: 3px;
  border-radius: 10px;
}

.files {
  text-align: right;
  margin-bottom: 10px;
}

.bubble .content {
  margin-left: 10px;
  flex: 1;
  font-size: 14px;
  color: #0f172a;
  word-break: break-word;
  line-height: 25px;
}

.glow {
  position: relative;
}

.glow::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 60%);
  pointer-events: none;
}

.glow-panel {
  position: relative;
}

.footer {
  padding: 10px;
  margin-top: 36px;
  width: 100%;
  height: auto;
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid #c9dbf3;
}

.steps-wrap {
  margin-bottom: 8px;
  font-size: 13px;
}

.steps-running {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: #f0f7ff;
  border-radius: 8px;
  border-left: 3px solid #38bdf8;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #475569;
}

.step-item.running .step-dot {
  background: #38bdf8;
  animation: pulse-dot 1s infinite;
}

.step-item.done .step-dot {
  background: #22c55e;
}

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #94a3b8;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
}

.step-name {
  color: #334155;
}

.steps-summary {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #64748b;
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 6px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  user-select: none;
  transition: background 0.15s;
}

.steps-summary:hover {
  background: #e2e8f0;
}

.steps-toggle {
  font-size: 10px;
}

.steps-done-list {
  margin-top: 5px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
  background: #f8fafc;
  border-radius: 6px;
}

.step-done-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}

.step-check {
  color: #22c55e;
  font-size: 11px;
}

.step-expand-btn {
  margin-left: auto;
  font-size: 11px;
  color: #38bdf8;
  cursor: pointer;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid #bae6fd;
  background: #f0f9ff;
  user-select: none;
  flex-shrink: 0;
}

.step-expand-btn:hover {
  background: #e0f2fe;
}

.thinking {
  padding: 10px;
  display: inline-block;
  animation: bounce 1.5s infinite;
  font-weight: 600;
  color: #409eff;
}

.thinking-sm {
  font-size: 12px;
  padding: 2px 0;
}

.thinking span {
  animation: dotBlink 1.5s infinite;
}

.thinking span:nth-child(1) { animation-delay: 0s; }
.thinking span:nth-child(2) { animation-delay: 0.3s; }
.thinking span:nth-child(3) { animation-delay: 0.6s; }

@keyframes dotBlink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-10px); }
  60% { transform: translateY(-5px); }
}

.kb-results,
.search-results {
  margin: 6px 0 8px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}

.kb-result-card {
  padding: 7px 10px;
  border-radius: 7px;
  background: #f6fdf9;
  border: 1px solid #d6f0e0;
  border-left: 3px solid #22c55e;
}

.kb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.kb-badge {
  font-size: 11px;
  font-weight: 600;
  color: #15803d;
  background: #dcfce7;
  border-radius: 4px;
  padding: 1px 6px;
  flex-shrink: 0;
}

.kb-source {
  font-size: 11px;
  color: #16a34a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.kb-sim {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: #0369a1;
  background: #e0f2fe;
  border-radius: 4px;
  padding: 1px 6px;
}

.kb-content {
  font-size: 12px;
  color: #475569;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.search-result-card {
  display: block;
  padding: 7px 10px;
  border-radius: 7px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}

.search-result-card:hover {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.sr-title {
  font-size: 13px;
  font-weight: 500;
  color: #1e40af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sr-meta {
  margin-top: 2px;
}

.sr-source {
  font-size: 11px;
  color: #16a34a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

.sr-snippet {
  margin-top: 3px;
  font-size: 12px;
  color: #64748b;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.parse-result {
  margin: 6px 0 8px 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  overflow: hidden;
  background: #f8fafc;
  width: 800px;
}

.pr-header {
  padding: 8px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pr-title {
  font-size: 13px;
  font-weight: 500;
  color: #1e40af;
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pr-title:hover {
  text-decoration: underline;
}

.pr-url {
  font-size: 11px;
  color: #16a34a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pr-content {
  padding: 10px 12px;
  font-size: 13px;
  color: #334155;
  line-height: 1.7;
  max-height: 400px;
  overflow-y: auto;
  word-break: break-word;
}

.chat-list::-webkit-scrollbar,
.bubble-list::-webkit-scrollbar {
  width: 6px;
}

.chat-list::-webkit-scrollbar-thumb,
.bubble-list::-webkit-scrollbar-thumb {
  background-color: rgba(56, 189, 248, 0.3);
  border-radius: 3px;
}

.chat-list::-webkit-scrollbar-track,
.bubble-list::-webkit-scrollbar-track {
  background: transparent;
}

@media (max-width: 900px) {
  .ai-doc-dialog {
    flex-direction: column;
    padding: 12px;
  }

  .sidebar {
    width: auto;
    min-height: 210px;
  }

  .header,
  .header-left {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
