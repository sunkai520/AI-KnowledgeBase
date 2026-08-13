<template>
  <div class="ai-doc-dialog">
    <!-- 左侧会话列表 -->
    <div class="sidebar">
      <div class="sidebar-header">会话列表</div>
      <div class="chat-list">
        <div
          v-for="(chat, idx) in chats"
          :key="idx"
          :class="['chat-item glow', { active: currentChatIndex === idx }]"
          @click="selectChat(idx)"
        >
          <el-avatar size="24" :class="chat.role">
            <el-icon v-if="chat.role === 'ai'"><ChatLineRound /></el-icon>
            <el-icon v-else><UserFilled /></el-icon>
          </el-avatar>
          <div class="chat-main">
            <div class="chat-preview">{{ chat.preview || "新会话" }}</div>
            <div class="chat-time" v-if="formatSessionTime(chat)">{{ formatSessionTime(chat) }}</div>
          </div>
          <div class="del">
            <el-icon
              color="red"
              size="16"
              @click.stop="delChatSession(chat, idx)"
              ><Delete
            /></el-icon>
          </div>
        </div>
      </div>
      <el-button
        type="primary"
        class="new-chat-btn glow"
        :disabled="
          chats.length > 0 && chats[currentChatIndex].messages.length <= 1
        "
        @click="createNewChat"
      >
        新建会话
      </el-button>
    </div>

    <!-- 右侧对话区 -->
    <div class="chat-panel glow-panel">
      <!-- 顶部标题 -->
      <div class="header">
        <el-icon size="20" color="#38bdf8"><Document /></el-icon>
        <span>AI 助手</span>
      </div>

      <!-- 对话列表 -->
      <div ref="listRef" class="bubble-list">
        <div
          v-for="(msg, idx) in currentMessages"
          :key="idx"
          :class="['bubble', msg.role, 'glow']"
        >
          <div class="ai" v-if="msg.role === 'ai'">
            <el-avatar :size="24" :class="msg.role">
              <el-icon><ChatLineRound /></el-icon>
            </el-avatar>
            <div style="flex: 1; min-width: 0">
              <!-- 执行步骤区 -->
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
                        >{{ step.expanded ? '收起' : '展开' }}</span>
                      </div>
                      <div v-if="step.expanded && step.results?.length" class="search-results">
                        <a v-for="(r, ri) in step.results" :key="ri" :href="r.url" target="_blank" class="search-result-card">
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
                          <a :href="step.parseResult.url" target="_blank" class="pr-title">{{ step.parseResult.title || step.parseResult.url }}</a>
                          <span class="pr-url">{{ step.parseResult.url }}</span>
                        </div>
                        <div class="pr-content" v-html="step.parseResult.markdown"></div>
                      </div>
                    </template>
                  </div>
                </template>
                <template v-else>
                  <div class="steps-summary" @click="msg.stepsExpanded = !msg.stepsExpanded">
                    <span class="steps-toggle">{{ msg.stepsExpanded ? '▾' : '▸' }}</span>
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
                        >{{ step.expanded ? '收起' : '展开' }}</span>
                      </div>
                      <div v-if="step.expanded && step.results?.length" class="search-results">
                        <a v-for="(r, ri) in step.results" :key="ri" :href="r.url" target="_blank" class="search-result-card">
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
                          <a :href="step.parseResult.url" target="_blank" class="pr-title">{{ step.parseResult.title || step.parseResult.url }}</a>
                          <span class="pr-url">{{ step.parseResult.url }}</span>
                        </div>
                        <div class="pr-content" v-html="step.parseResult.markdown"></div>
                      </div>
                    </template>
                  </div>
                </template>
              </div>

              <!-- 思考中（无步骤时） -->
              <div class="thinking" v-if="msg.thinking && !msg.steps?.length">
                思考中<span>.</span><span>.</span><span>.</span><span class="thinking-hint">{{ thinkingHint(msg) }}</span>
              </div>
              <!-- 工具全部完成，等待模型生成回答 -->
              <div class="thinking" v-else-if="msg.thinking && msg.steps?.length && msg.steps.every(s => s.status === 'done')">
                整理中<span>.</span><span>.</span><span>.</span><span class="thinking-hint">{{ thinkingHint(msg) }}</span>
              </div>
              <!-- 工具执行中 -->
              <div class="thinking thinking-sm" v-else-if="msg.thinking && msg.steps?.length">
                执行中<span>.</span><span>.</span><span>.</span><span class="thinking-hint">{{ thinkingHint(msg) }}</span>
              </div>

              <!-- 最终回答 -->
              <div class="content" v-if="msg.content">
                <MarkDwon :content="msg.content" :isStreaming="idx === currentMessages.length - 1 && loading"></MarkDwon>
                <div class="options">
                  <div class="copy" @click="copy(msg.content)">
                    <el-icon><CopyDocument /></el-icon>
                    <span>复制</span>
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
      </div>
      <div style="margin-top: 36px;">
        <QuickModelBar v-model:modelName="quickModelName" />
         <footer class="footer">
        <AiInput
          class="aiInput"
          @componentParams="handleSend"
          @stop="stopGeneration"
          :loading="loading"
        ></AiInput>
      </footer>
      </div>
     
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, computed, watch, onUnmounted } from "vue";
import {
  ChatLineRound,
  Document,
  UserFilled,
  Delete,
  CopyDocument,
} from "@element-plus/icons-vue";
import AiInput from "../../../components/aiInput.vue";
import QuickModelBar from "../../../components/quickModelBar.vue";
import MessageAttachments from "../../../components/messageAttachments.vue";
import {
  createSessionId,
  sessionList,
  getSessionMessages,
  delSession,
} from "@renderer/api/chat.ts";
import MarkDwon from "@renderer/components/markDwon.vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { formatSessionTime } from "@renderer/utils/common";
import { copyText } from "@renderer/utils/common";
const chats = ref([]);
const currentChatIndex = ref(0);
const text = ref("");
const loading = ref(false);
const listRef = ref(null);
const quickModelName = ref("");

// 命中原生联网搜索/深度推理时，模型可能几分钟内不返回任何一个字（服务端自主搜索期间没有增量可转发），
// 只靠"思考中..."几个字用户会以为卡死了，所以额外显示已等待秒数 + 长耗时提示，证明连接还活着
const nowTick = ref(Date.now());
let tickTimer = null;
onMounted(() => {
  tickTimer = setInterval(() => { nowTick.value = Date.now(); }, 1000);
});
function thinkingElapsedSec(msg) {
  if (!msg?.thinkingStartedAt) return 0;
  return Math.max(0, Math.floor((nowTick.value - msg.thinkingStartedAt) / 1000));
}
function thinkingHint(msg) {
  const sec = thinkingElapsedSec(msg);
  if (sec < 10) return "";
  if (sec < 60) return `（已等待 ${sec} s）`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `（已等待 ${m}m${s}s，命中原生联网搜索/深度推理时模型会在服务端自主搜索，期间不会有任何增量返回，请耐心等待，通常 1~3 分钟）`;
}

const currentMessages = computed(() =>
  chats.value.length > 0 ? chats.value[currentChatIndex.value].messages : []
);
function copy(text) {
  copyText(text);
}
function buildWelcomeMessage() {
  return "您好,我是您的贴心小助理,请问有什么可以帮助您的?";
}
function buildWelcomeMessages() {
  return [{ role: "ai", content: buildWelcomeMessage() }];
}
function mapPersistedMessage(item) {
  return {
    role: item.role === "assistant" ? "ai" : item.role,
    content: item.content || "",
    files: item.files,
    tools: item.tools,
    toolResults: item.toolResults,
  };
}
// 知识库内容常含 HTML/富文本标记，仅在卡片展示层剥离标签、解码实体、压缩空白（不影响喂给模型的内容）
const _htmlDecoder = document.createElement("textarea");
function stripHtml(html) {
  if (!html) return "";
  let text = String(html).replace(/<[^>]+>/g, " ");
  _htmlDecoder.innerHTML = text;
  text = _htmlDecoder.value;
  return text.replace(/\s+/g, " ").trim();
}
function delChatSession(chat, index) {
  ElMessageBox.confirm("确定删除吗?", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).then(async () => {
    let res = await delSession({ sessionId: chat.sessionId });
    ElMessage.success("删除成功");
    chats.value.splice(index, 1);
    if (!chats.value.length) {
      await createNewChat();
      return;
    }
    if (index === currentChatIndex.value) {
      currentChatIndex.value = Math.min(index, chats.value.length - 1);
      // 删除的正是当前激活的对话：切到相邻对话后，还要实际加载它的消息，
      // 否则右侧只是换了个 index，内容还是空的/上一个对话的残留
      await loadChatMessages(chats.value[currentChatIndex.value]);
      scrollBottom(true);
    } else if (index < currentChatIndex.value) {
      currentChatIndex.value--;
    }
  });
}
let scrollTimer = null;

// #5: 判断是否接近底部（60px 阈值），用户向上滚动查看历史时不强制跳到底
function isNearBottom() {
  if (!listRef.value) return true;
  const { scrollTop, scrollHeight, clientHeight } = listRef.value;
  return scrollHeight - scrollTop - clientHeight < 60;
}

function scrollBottom(immediate = false) {
  if (immediate) {
    nextTick(() => {
      if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight;
    });
    return;
  }
  // 用户已向上滚动查看历史时，不打断阅读
  if (!isNearBottom()) return;
  if (scrollTimer) return;
  scrollTimer = requestAnimationFrame(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight;
    scrollTimer = null;
  });
}

async function selectChat(idx) {
  currentChatIndex.value = idx;
  await loadChatMessages(chats.value[idx]);
  scrollBottom();
}

async function loadChatMessages(chat) {
  if (!chat?.sessionId || chat.messagesLoaded) return;
  try {
    const res = await getSessionMessages(chat.sessionId);
    const messages = (res.data || []).map(mapPersistedMessage).filter((item) => item.content);
    chat.messages = messages.length ? messages : buildWelcomeMessages();
    chat.messagesLoaded = true;
  } catch (err) {
    console.error("load chat messages failed:", err);
    chat.messages = chat.messages?.length ? chat.messages : buildWelcomeMessages();
  }
}

async function createNewChat() {
  if (loading.value) {
   let rr =  await ElMessageBox.confirm(
      "当前会话正在生成中，是否要中断生成?",
      "提示",
      {
        confirmButtonText: "确定",
        cancelButtonText: "取消",
        type: "warning",
      },
    )
    stopGeneration();
  };
  
  let res = await createSessionId();
  console.log(res, "rrr");
  const chat = {
    role: "ai",
    preview: "",
    sessionId: res.data.sessionId,
    messages: [
      {
        role: "ai",
        content: buildWelcomeMessage(),
      },
    ],
  };
  chat.messagesLoaded = true;
  chats.value.unshift(chat);
  currentChatIndex.value = 0;
  scrollBottom();
}
function stopGeneration() {
  if (!abortController) return;

  abortController.abort();
  abortController = null;
  loading.value = false;

  // 处理最后一条消息：必须用 generatingChat（真正在生成的那个对话），
  // 不能用 currentMessages——用户点"停止"时看到的可能已经是切换过去的别的对话
  const msgs = generatingChat?.messages || currentMessages.value;
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg?.role === 'ai') {
    lastMsg.loading = false;
    lastMsg.thinking = false;
    if (!lastMsg.content) {
      lastMsg.content = '（已停止生成）';
    }
  }
  generatingChat = null;
}
// 清理函数（组件卸载时）
onUnmounted(() => {
  if (abortController) {
    abortController.abort();
  }
  if (tickTimer) clearInterval(tickTimer);
});
let abortController = null;
let generatingChat = null; // 当前正在流式生成的对话对象引用，与"用户正在看哪个对话"（currentChatIndex）解耦
// 获取 AI 回复
const getAnswer = (params,signal) => {
  let url = "http://localhost:5120/chat/agentChat";
  return fetch(url, {
    method: "post",
    responseType: "stream",
    body: JSON.stringify(params),
    timeout: 60 * 1000,
    headers: {
      "content-type": "application/json",
    },
    signal,  // 用于中断
  });
};

async function handleSend(data) {
  if (!data.question.trim() || loading.value) return;
  
  // 创建新的中断控制器
  abortController = new AbortController();
  
  const userText = data.question;
  const activeChat = chats.value[currentChatIndex.value];
  if (activeChat) {
    activeChat.preview = userText.slice(0, 28);
    activeChat.messagesLoaded = true;
    if (currentChatIndex.value !== 0) {
      chats.value.splice(currentChatIndex.value, 1);
      chats.value.unshift(activeChat);
      currentChatIndex.value = 0;
    }
  }
  // 全程用 activeChat.messages（固定引用），不用 currentMessages（跟随 currentChatIndex 变化）——
  // 否则生成过程中用户点了别的历史对话，后续所有 chunk 都会写进"当前正在看的对话"而不是发起请求的那个，导致内容错乱
  generatingChat = activeChat;
  const isStillViewing = () => activeChat === chats.value[currentChatIndex.value];

  // 添加用户消息
  activeChat.messages.push({
    role: "user",
    content: userText,
    files: data.uploadedDocs.map(m => m.filePath).join(","),
  });

  text.value = "";
  loading.value = true;

  // 添加 AI 占位消息
  activeChat.messages.push({
    role: "ai",
    content: "",
    loading: true,
    thinking: true,
    thinkingStartedAt: Date.now(),
    tools: "",
    steps: [],
    stepsExpanded: true,
  });

  if (isStillViewing()) scrollBottom();
  try {
    const response = await getAnswer({
      q: userText,
      sessionId: activeChat.sessionId,
      isOnline: data.useExternalResource,
      uploadedDocs: data.uploadedDocs.map(m => ({
        filePath: m.filePath,
        sizeFormatted: m.sizeFormatted,
        type: m.type,
      })),
      localChecked: data.localChecked,
      modelName: quickModelName.value,
    }, abortController.signal);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";

    while (true) {
      if (abortController?.signal.aborted) {
        await reader.cancel();
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        loading.value = false;
        const lastMsg = activeChat.messages[activeChat.messages.length - 1];
        if (lastMsg?.role === 'ai') {
          lastMsg.loading = false;
          lastMsg.thinking = false;
          if (!lastMsg.content) {
            lastMsg.content = '❌ 请求失败，请检查模型配置后重试';
          }
        }
        abortController = null;
        generatingChat = null;
        // 和流式过程中每个 chunk 一样，只在用户本来就停留在底部时才跟随滚动，
        // 避免用户往上翻看历史时被 AI 说完话硬拽回底部
        if (isStillViewing()) scrollBottom();
        break;
      }

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "DONE" || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          const lastMsg = activeChat.messages[activeChat.messages.length - 1];
          if (event.type === "error") {
            const msg = friendlyError(event.error || event.content);
            lastMsg.content = `❌ ${msg}`;
            lastMsg.loading = false;
            lastMsg.thinking = false;
            loading.value = false;
            ElMessage.error({ message: msg, duration: 5000 });
          } else if (event.content) {
            lastMsg.content += event.content;
            lastMsg.tools = event.tool;
            // 只有出现可见文字才清除思考状态（首 token 可能是 \n\n，是 truthy 但不可见）
            if (typeof event.content === 'string' && event.content.trim()) {
              lastMsg.loading = false;
              lastMsg.thinking = false;
            }
          } else if (event.type === "tool_start") {
            const idx = activeChat.messages.length - 1;
            activeChat.messages[idx].steps = [
              ...(activeChat.messages[idx].steps || []),
              { tool: event.toolName, displayName: event.displayName, status: 'running', expanded: false },
            ];
          } else if (event.type === "tool_done") {
            const idx = activeChat.messages.length - 1;
            const steps = [...(activeChat.messages[idx].steps || [])];
            const ri = [...steps].reverse().findIndex(s => s.status === 'running');
            if (ri !== -1) steps[steps.length - 1 - ri] = { ...steps[steps.length - 1 - ri], status: 'done' };
            activeChat.messages[idx].steps = steps;
          } else if (event.type === "tool_result") {
            const idx = activeChat.messages.length - 1;
            const steps = [...(activeChat.messages[idx].steps || [])];
            const ri = [...steps].reverse().findIndex(s => s.tool === event.toolName);
            if (ri !== -1) {
              const si = steps.length - 1 - ri;
              if (event.toolName === 'webSearch') {
                steps[si] = { ...steps[si], results: event.results };
              } else if (event.toolName === 'searchLocalKB') {
                steps[si] = { ...steps[si], kbResults: event.results };
              } else if (event.toolName === 'parseWebPage') {
                steps[si] = { ...steps[si], parseResult: event.parseResult };
              }
            }
            activeChat.messages[idx].steps = steps;
          }
        } catch (e) {
          console.error('SSE 解析错误:', e, line);
        }
      }
      if (isStillViewing()) scrollBottom();
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('生成已中断');
    } else {
      console.error('请求错误:', err);
      const lastMsg = activeChat.messages[activeChat.messages.length - 1];
      if (lastMsg?.role === 'ai') {
        lastMsg.content = '生成失败，请重试';
        lastMsg.loading = false;
      }
    }
    loading.value = false;
    abortController = null;
    generatingChat = null;
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

async function getSessionList() {
  // #4: pageSize 从 9999 改为 100，避免一次性加载全部会话及其消息
  let res = await sessionList({
    page: 1,
    pageSize: 100,
    userId: 1,
  });
  if (!res.data.list || res.data.list.length == 0) {
    await createNewChat();
    return;
  } else {
    res.data.list = res.data.list.map((e) => ({
      ...e,
      role: "ai",
      preview: e.preview || "",
      messages: buildWelcomeMessages(),
      messagesLoaded: false,
    }));
    chats.value = res.data.list;
  }
  currentChatIndex.value = 0;
  await loadChatMessages(chats.value[0]);
  console.log(res, "res111");
}
onMounted(() => {
  scrollBottom();
  getSessionList();
});
</script>

<style scoped lang="scss">
/* === 整体容器 === */
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
/* === 步骤执行区 === */
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
  &.running .step-dot { background: #38bdf8; animation: pulse-dot 1s infinite; }
  &.done .step-dot   { background: #22c55e; }
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
  50%       { opacity: 0.5; transform: scale(0.8); }
}
.step-name { color: #334155; }
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
  &:hover { background: #e2e8f0; }
}
.steps-toggle { font-size: 10px; }
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
.step-check { color: #22c55e; font-size: 11px; }
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
  &:hover { background: #e0f2fe; }
}
.thinking-sm { font-size: 12px; padding: 2px 0; }

/* 本地知识库结果卡片列表 */
.kb-results {
  margin: 6px 0 8px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}
.kb-results::-webkit-scrollbar { width: 4px; }
.kb-results::-webkit-scrollbar-thumb { background: rgba(34,197,94,0.3); border-radius: 2px; }
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

/* 搜索结果卡片列表 */
.search-results {
  margin: 6px 0 8px 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
  padding-right: 4px;
}
.search-results::-webkit-scrollbar { width: 4px; }
.search-results::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.3); border-radius: 2px; }
.search-result-card {
  display: block;
  padding: 7px 10px;
  border-radius: 7px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
  &:hover { background: #eff6ff; border-color: #bfdbfe; }
}
.sr-title {
  font-size: 13px;
  font-weight: 500;
  color: #1e40af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-meta { margin-top: 2px; }
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

/* 网站解析结果 */
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
  &:hover { text-decoration: underline; }
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
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: rgba(56,189,248,0.3); border-radius: 2px; }

  // 渲染 HTML 内容的基础重置
  :deep(img) { max-width: 100%; height: auto; border-radius: 4px; }
  :deep(a) { color: #2563eb; text-decoration: underline; word-break: break-all; }
  :deep(table) { border-collapse: collapse; width: 100%; font-size: 12px; margin: 8px 0; }
  :deep(th), :deep(td) { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; }
  :deep(th) { background: #f1f5f9; font-weight: 600; }
  :deep(h1), :deep(h2), :deep(h3), :deep(h4) { font-weight: 600; margin: 10px 0 4px; color: #0f172a; }
  :deep(h1) { font-size: 16px; } :deep(h2) { font-size: 15px; } :deep(h3) { font-size: 14px; }
  :deep(p) { margin: 4px 0; }
  :deep(ul), :deep(ol) { padding-left: 20px; margin: 4px 0; }
  :deep(li) { margin: 2px 0; }
  :deep(pre), :deep(code) { background: #f1f5f9; border-radius: 4px; font-size: 12px; padding: 2px 5px; }
  :deep(pre) { padding: 8px 12px; overflow-x: auto; white-space: pre; }
  :deep(blockquote) { border-left: 3px solid #38bdf8; padding-left: 10px; color: #64748b; margin: 6px 0; }
  :deep(hr) { border: none; border-top: 1px solid #e2e8f0; margin: 8px 0; }
}

/* 样式部分 */
.thinking {
  padding: 10px; /* 内边距 */
  display: inline-block; /* 防止其占满整个行 */
  animation: bounce 1.5s infinite; /* 动画效果 */
  font-weight: 600;
  color: #409eff;
}

.thinking-hint {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #909399;
  animation: none;
}

/* 点点点的动画 */
.thinking span {
  animation: dotBlink 1.5s infinite;
}

.thinking span:nth-child(1) {
  animation-delay: 0s;
}
.thinking span:nth-child(2) {
  animation-delay: 0.3s;
}
.thinking span:nth-child(3) {
  animation-delay: 0.6s;
}

/* 点的闪烁效果 */
@keyframes dotBlink {
  0%,
  100% {
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
}

/* 跳动动画 */
@keyframes bounce {
  0%,
  20%,
  50%,
  80%,
  100% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-10px);
  }
  60% {
    transform: translateY(-5px);
  }
}
.footer {
  padding: 10px;
  
  width: 100%;
  height: auto;
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid #c9dbf3;
}
/* === 左侧会话历史 === */
.sidebar {
  width: 220px;
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

.chat-list {
  padding: 0 5px;
  flex: 1;
  overflow-y: auto;
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
}
.chat-item:hover {
  .del {
    display: block;
  }
}
.del {
  display: none;
}
.chat-item.active {
  background: rgba(56, 189, 248, 0.12);
}

.chat-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chat-preview {
  font-size: 14px;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-time {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.new-chat-btn {
  margin: 12px 16px;
  border-radius: 16px;
}

/* === 右侧聊天区 === */
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
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #0f172a;
}

/* === 聊天气泡列表 === */
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
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition: all 0.35s ease;
  position: relative;
  .ai {
    display: flex;
    // align-items: center;
  }
  .copy {
    cursor: pointer;
    display: flex;
    align-items: center;
    span {
      margin-left: 5px;
    }
  }
  .options {
    display: flex;
    justify-content: flex-end;
  }
  .humanUser {
    display: flex;
    justify-content: flex-end;
    .right {
      display: flex;
      // align-items: center;
      .content {
        margin-right: 10px;
        color: blue;
        font-weight: 600;
        white-space: pre-wrap;
        word-break: break-word;
      }
    }
  }
}
.tools,
.files {
  font-size: 14px;
  color: grey;
  // background: linear-gradient(180deg, #a9e1b9, #8ea5bd);
  padding: 3px;
  border-radius: 10px;
}
.tools {
  margin-left: 10px;
  display: inline-block;
  border-bottom: 1px solid rgb(15, 87, 202);
  margin-bottom: 10px;
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

/* === Glow 效果 === */
.glow {
  position: relative;
}

.glow::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 16px;
  background: radial-gradient(
    circle at top,
    rgba(56, 189, 248, 0.12),
    transparent 60%
  );
  pointer-events: none;
}

.glow-panel {
  position: relative;
}

/* === 自适应滚动条美化 (可选) === */
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
</style>
