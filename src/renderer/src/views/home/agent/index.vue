<template>
  <div class="agent-page">

    <!-- 左侧会话列表 -->
    <div class="sidebar">
      <div class="sidebar-header">会话列表</div>
      <div class="session-list">
        <div
          v-for="s in sessions"
          :key="s.sessionId"
          :class="['session-item glow', { active: currentSessionId === s.sessionId }]"
          @click="selectSession(s)"
        >
          <el-avatar size="24" class="ai">
            <el-icon><Cpu /></el-icon>
          </el-avatar>
          <div class="session-main">
            <div class="session-preview">{{ s.lastMessage || '新会话' }}</div>
            <div class="session-time" v-if="formatSessionTime(s)">{{ formatSessionTime(s) }}</div>
          </div>
          <div class="del">
            <el-icon color="red" size="16" @click.stop="handleDeleteSession(s)"><Delete /></el-icon>
          </div>
        </div>
      </div>
      <el-button
        type="primary"
        class="new-chat-btn glow"
        :disabled="sessions.length > 0 && sessions[currentIndex] && !currentSessionId"
        :loading="creatingSession"
        @click="handleNewSession"
      >
        新建会话
      </el-button>
    </div>

    <!-- 右侧对话区 -->
    <div class="chat-panel glow-panel">
      <!-- 顶部标题 -->
      <div class="header">
        <el-icon size="20" color="#38bdf8"><Cpu /></el-icon>
        <span>超级AI员工</span>
      </div>

      <!-- 工作目录：execute 工具的弱隔离边界，按会话独立设置 -->
      <div v-if="currentSessionId" class="workdir-bar">
        <span class="workdir-label">工作目录：</span>
        <span class="workdir-path" :title="currentWorkDir">{{ currentWorkDir || '未设置，首次执行命令时自动创建' }}</span>
        <span class="workdir-change" @click="handleChangeWorkDir">
          <el-icon><FolderOpened /></el-icon>
          <span>更改工作目录</span>
        </span>
      </div>

      <!-- 消息列表 -->
      <div ref="listRef" class="bubble-list" @scroll="handleListScroll">

        <!-- 无会话时的空态 -->
        <div v-if="!currentSessionId" class="empty-state">
          <el-empty description="新建会话开始对话" :image-size="80" />
        </div>

        <template v-else>
          <div
            v-for="(msg, idx) in messages"
            :key="idx"
            :class="['bubble', msg.role, 'glow']"
          >
            <!-- AI 消息 -->
            <div class="ai-wrap" v-if="msg.role === 'assistant'">
              <el-avatar size="24" class="ai">
                <el-icon><Cpu /></el-icon>
              </el-avatar>

              <!-- 中断审批：记录展示在消息流里，操作按钮统一放到下方弹窗，避免重复入口 -->
              <div v-if="msg.interrupted" style="flex:1;min-width:0">
                <div class="interrupt-tip">
                  <el-icon color="#f59e0b"><Warning /></el-icon>
                  需要确认（见弹窗）
                </div>
                <div class="content" v-html="renderInterrupt(msg.content)"></div>
              </div>

              <!-- 正常内容区 -->
              <div v-else style="flex:1;min-width:0">

                <!-- 任务清单（write_todos 产出，自动续跑时展示当前进度） -->
                <div v-if="msg.todos && msg.todos.length" class="todos-wrap">
                  <div v-for="(todo, ti) in msg.todos" :key="ti" :class="['todo-item', todo.status]">
                    <span class="todo-icon">{{ todo.status === 'completed' ? '✓' : (todo.status === 'in_progress' ? '●' : '○') }}</span>
                    <span class="todo-content">{{ todo.content }}</span>
                  </div>
                </div>

                <!-- 执行步骤区 -->
                <div v-if="msg.steps && msg.steps.length" class="steps-wrap">
                  <!-- 执行中：展开显示进度 -->
                  <template v-if="msg.thinking">
                    <div class="steps-running">
                      <template v-for="(step, si) in msg.steps" :key="si">
                        <div v-if="step.tool === '__round__'" class="round-marker">— 第 {{ step.round }} 轮 —</div>
                        <div v-else :class="['step-item', step.status]">
                          <span class="step-dot"></span>
                          <span class="step-name">{{ getStepName(step) }}</span>
                        </div>
                      </template>
                    </div>
                  </template>
                  <!-- 完成后：折叠摘要 -->
                  <template v-else>
                    <div class="steps-summary" @click="msg.stepsExpanded = !msg.stepsExpanded">
                      <span class="steps-toggle">{{ msg.stepsExpanded ? '▾' : '▸' }}</span>
                      已执行 {{ msg.steps.length }} 个步骤
                      <span v-if="sending && idx === messages.length - 1" class="inline-loading">
                        <span class="loading-dot"></span>
                        <span class="loading-dot"></span>
                        <span class="loading-dot"></span>
                        <span class="loading-text">执行中...</span>
                      </span>
                    </div>
                    <div v-if="msg.stepsExpanded" class="steps-done-list">
                      <template v-for="(step, si) in msg.steps" :key="si">
                        <div v-if="step.tool === '__round__'" class="round-marker">— 第 {{ step.round }} 轮 —</div>
                        <div v-else class="step-done-item">
                          <span class="step-check">✓</span>
                          <span>{{ getStepName(step) }}</span>
                        </div>
                      </template>
                    </div>
                  </template>
                </div>

                <!-- 思考中（还没有步骤时显示；有 thinkingContent 则流式展示思考过程） -->
                <div class="thinking" v-if="msg.thinking && !msg.steps?.length">
                  <template v-if="msg.thinkingContent">
                    <div class="thinking-text">{{ msg.thinkingContent }}</div>
                  </template>
                  <template v-else>
                    思考中<span>.</span><span>.</span><span>.</span>
                  </template>
                </div>
                <!-- 有步骤但还在执行中，步骤下方也加一个小提示 -->
                <div class="thinking thinking-sm" v-else-if="msg.thinking && msg.steps?.length">
                  执行中<span>.</span><span>.</span><span>.</span>
                </div>

                <!-- 最终回答 -->
                <div class="content" v-if="msg.content">
                  <MarkDwon :content="msg.content" :isStreaming="idx === messages.length - 1 && sending" />
                  <div class="options">
                    <div class="copy" @click="copyText(msg.content)">
                      <el-icon><CopyDocument /></el-icon>
                      <span>复制</span>
                    </div>
                  </div>
                </div>

                <div v-if="msg.skillReview" class="feedback-card skill-review-card">
                  <div class="feedback-head">
                    <div>
                      <div class="feedback-title">沉淀为 Skill</div>
                      <div class="feedback-subtitle">
                        本次任务已有可复用执行轨迹，你可以决定是否让模型生成或更新 Skill。
                      </div>
                    </div>
                  </div>
                  <div v-if="msg.skillReview.summary" class="skill-review-summary">
                    {{ msg.skillReview.summary }}
                  </div>
                  <div class="feedback-actions">
                    <span v-if="msg.skillReview.status === 'skipped'" class="feedback-saved-tip">已跳过</span>
                    <span v-else-if="msg.skillReview.status === 'running'" class="feedback-saved-tip">正在生成 Skill 草案...</span>
                    <template v-if="msg.skillReview.status === 'pending'">
                      <el-button class="feedback-btn" :disabled="sending" @click="skipSkillReview(msg)">
                        跳过
                      </el-button>
                      <el-button class="feedback-btn primary" :disabled="sending" @click="confirmSkillReview(msg)">
                        生成/更新 Skill
                      </el-button>
                    </template>
                  </div>
                </div>
              </div>
            </div>

            <!-- 用户消息 -->
            <div class="humanUser" v-else>
              <div class="right">
                <div class="content">
                  <MessageAttachments :files="msg.files" />
                  <div>{{ msg.content }}</div>
                </div>
                <el-avatar size="24" class="user">
                  <el-icon><UserFilled /></el-icon>
                </el-avatar>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 回到底部：用户往上翻看历史时出现，点击后跳到最新消息并恢复自动跟随 -->
      <transition name="scroll-btn-fade">
        <div v-if="showScrollBtn" class="scroll-bottom-btn" @click="scrollBottom(true)">
          <el-icon><Bottom /></el-icon>
        </div>
      </transition>

      <!-- 输入区：复用 AI助手 的 aiInput 组件 -->
      <footer class="footer" v-if="currentSessionId">
        <AiInput
          :loading="sending"
          :show-internet-toggle="false"
          :show-permission-select="true"
          :permission-level="currentPermissionLevel"
          @update:permissionLevel="handlePermissionLevelChange"
          @componentParams="handleSend"
          @stop="stopGeneration"
        />
      </footer>
    </div>

    <!-- Skills 管理 Dialog（暂时保留但不在页面显示入口） -->
    <el-dialog
      v-model="createSkillDialog"
      title="创建新 Skill"
      width="440px"
      destroy-on-close
      align-center
    >
      <el-form label-position="top">
        <el-form-item label="目录名（小写字母 / 数字 / -）">
          <el-input v-model="newSkill.name" placeholder="例：web-search" />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="newSkill.displayName" placeholder="例：网络搜索" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="newSkill.description" type="textarea" :rows="2" placeholder="例：用于联网搜索最新信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createSkillDialog = false">取消</el-button>
        <el-button type="primary" :loading="creatingSkill" @click="handleCreateSkill">创建</el-button>
      </template>
    </el-dialog>

    <!-- 工具执行审批浮层：右下角常驻卡片，操作都在这里进行，不用弹窗遮罩 -->
    <transition name="interrupt-toast-fade">
      <div v-if="interruptedMessage" class="interrupt-toast">
        <div class="interrupt-toast-header">
          <el-icon color="#f59e0b"><Warning /></el-icon>
          <span>{{ interruptedMessage.interruptKind === 'browser_blocked' ? '需要手动处理' : '需要确认' }}</span>
        </div>
        <div class="interrupt-toast-scroll">
          <div class="interrupt-toast-body" v-html="renderInterrupt(interruptedMessage.content)"></div>

          <!-- 多个待审批调用：逐条列出，每条各自同意/拒绝 -->
          <div v-if="interruptedMessage.interruptRows" class="interrupt-rows">
            <div
              v-for="(row, i) in interruptedMessage.interruptRows"
              :key="i"
              class="interrupt-row"
              :class="{ 'is-approved': row.decision === 'approve', 'is-rejected': row.decision === 'reject' }"
            >
              <div class="interrupt-row-index">第 {{ i + 1 }}/{{ interruptedMessage.interruptRows.length }} 个</div>
              <div class="interrupt-row-text" v-html="renderInterrupt(row.text)"></div>
              <div class="interrupt-row-actions">
                <el-button
                  size="small"
                  :type="row.decision === 'reject' ? 'danger' : 'default'"
                  :disabled="sending"
                  @click="setRowDecision(i, 'reject')"
                >拒绝</el-button>
                <el-button
                  size="small"
                  :type="row.decision === 'approve' ? 'primary' : 'default'"
                  :disabled="sending"
                  @click="setRowDecision(i, 'approve')"
                >同意</el-button>
              </div>
            </div>
          </div>
        </div>

        <img
          v-if="interruptedMessage.interruptScreenshot"
          :src="interruptedMessage.interruptScreenshot"
          class="interrupt-toast-screenshot"
        />
        <div class="interrupt-toast-actions">
          <template v-if="interruptedMessage.interruptKind === 'browser_blocked'">
            <el-button size="small" :disabled="sending" @click="resumeChat('switch_method')">换个方式</el-button>
            <el-button type="primary" size="small" :disabled="sending" @click="resumeChat('continue')">已处理，继续</el-button>
          </template>
          <template v-else-if="interruptedMessage.interruptDedup">
            <el-button size="small" :disabled="sending" @click="resumeChat('reject')">取消</el-button>
            <el-button size="small" :disabled="sending" @click="mergeSkill()">合并</el-button>
            <el-button type="primary" size="small" :disabled="sending" @click="resumeChat('approve')">直接创建</el-button>
          </template>
          <template v-else-if="interruptedMessage.interruptRows">
            <el-button size="small" :disabled="sending" @click="setAllRowDecisions('reject')">全部拒绝</el-button>
            <el-button size="small" :disabled="sending" @click="setAllRowDecisions('approve')">全部同意</el-button>
            <el-button
              type="primary"
              size="small"
              :disabled="sending || !allInterruptRowsDecided"
              @click="submitRowDecisions()"
            >提交决定</el-button>
          </template>
          <template v-else>
            <el-button size="small" :disabled="sending" @click="resumeChat('reject')">拒绝</el-button>
            <el-button type="primary" size="small" :disabled="sending" @click="resumeChat('approve')">同意执行</el-button>
          </template>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onUnmounted, onActivated } from "vue";
import { Cpu, Delete, UserFilled, CopyDocument, Warning, FolderOpened, Bottom } from "@element-plus/icons-vue";
import AiInput from "@renderer/components/aiInput.vue";
import MessageAttachments from "@renderer/components/messageAttachments.vue";
import { formatSessionTime } from "@renderer/utils/common";

const TOOL_NAMES = {
  read_file:      '读取文件',
  write_file:     '写入文件',
  edit_file:      '编辑文件',
  ls:             '浏览目录',
  glob:           '查找文件',
  grep:           '搜索内容',
  generateWord:   '生成文档',
  generate_image:              '文生图',
  generate_video_from_image:   '图生视频',
  generate_video_from_frames:  '首尾帧生视频',
  generate_video_from_references: '参考生视频',
  compose_video:               '视频合成',
  extract_video_last_frame:    '截取末帧',
  write_todos:      '更新任务清单',
  execute:          '执行命令',
  run_command:      '执行命令',
  create_skill:     '创建Skill',
  list_workdir:     '浏览工作目录',
  read_workdir_file:'读取工作目录文件',
  task:             '委托子Agent处理',
};

const BROWSER_ACTION_NAMES = {
  openUrl:    '浏览器-打开网页',
  state:      '浏览器-获取页面',
  screenshot: '浏览器-截图',
  click:      '浏览器-点击元素',
  inputText:  '浏览器-输入文本',
  getText:    '浏览器-提取文本',
  scroll:     '浏览器-滚动页面',
  keys:       '浏览器-模拟按键',
  wait:       '浏览器-等待加载',
  back:       '浏览器-返回上页',
};

function getStepName(step) {
  if (step.tool === 'browser') {
    return BROWSER_ACTION_NAMES[step.action] || '浏览器操作';
  }
  if (step.tool === 'run_command' && step.action === 'auto_approved') {
    return '执行命令（已自动批准）';
  }
  return TOOL_NAMES[step.tool] || step.tool;
}
import { ElMessage, ElMessageBox } from "element-plus";
import MarkDwon from "@renderer/components/markDwon.vue";
import {
  getAgentSessions, createAgentSession, deleteAgentSession, getSessionMessages,
  getAgentSkills, updateSkillEnabled, createSkill, updateSessionWorkDir,
  updateSessionPermission,
} from "@renderer/api/agent.ts";
import { copyText } from "@renderer/utils/common";

defineOptions({ name: "AgentIndex" });

// ─── 会话 ────────────────────────────────────────────────────────────────
const sessions        = ref([]);
const currentSessionId = ref("");
const currentIndex    = ref(0);
const messages        = ref([]);
const creatingSession = ref(false);
const listRef         = ref(null);
// 是否"贴底"：贴底时新内容自动滚到最新；用户往上翻看历史时暂停自动滚动，不打断阅读
const stickToBottom   = ref(true);
const showScrollBtn   = ref(false);
const SCROLL_BOTTOM_THRESHOLD = 80;

// 当前是否有待审批的中断（驱动审批弹窗的显示）
const interruptedMessage = computed(() => {
  const last = messages.value[messages.value.length - 1];
  return last && last.role === "assistant" && last.interrupted ? last : null;
});

// ─── 聊天 ────────────────────────────────────────────────────────────────
const sending         = ref(false);
let   abortController = null;
const currentThreadId = ref("");
const pendingSkillReview = ref(null);

// ─── Skills（暂不展示入口）────────────────────────────────────────────────
const createSkillDialog = ref(false);
const creatingSkill     = ref(false);
const newSkill = reactive({ name: "", displayName: "", description: "" });

// ─────────────────────────────────────────────────────────────────────────
// 会话管理
// ─────────────────────────────────────────────────────────────────────────

// 当前会话的命令执行工作目录（execute 工具的弱隔离边界）
const currentWorkDir = computed(() => {
  const s = sessions.value.find(s => s.sessionId === currentSessionId.value);
  return s?.workDir || "";
});

async function handleChangeWorkDir() {
  if (!currentSessionId.value) return;
  try {
    const dir = await window.electronAPI.selectAgentWorkDir();
    if (!dir) return; // 用户取消
    await updateSessionWorkDir(currentSessionId.value, dir);
    const s = sessions.value.find(s => s.sessionId === currentSessionId.value);
    if (s) s.workDir = dir;
    ElMessage.success("工作目录已更新");
  } catch (e) {
    ElMessage.error("设置工作目录失败：" + (e?.message || ""));
  }
}

// 当前会话的命令执行审批级别：confirm=1级需人工确认（默认）/ auto=2级自动同意 / unrestricted=3级完全放开
const currentPermissionLevel = computed(() => {
  const s = sessions.value.find(s => s.sessionId === currentSessionId.value);
  return ["auto", "unrestricted"].includes(s?.permissionLevel) ? s.permissionLevel : "confirm";
});

async function handlePermissionLevelChange(level) {
  if (!currentSessionId.value) return;
  // 3级会跳过工作目录越权校验（环境变量展开、重定向越界等都不再拦截），一旦切换过去，
  // 模型执行的任何命令都会原样丢给真实 shell、不设防地在本机跑——必须让用户先明确知情同意，
  // 不能像 1/2 级之间切换那样点一下就悄悄生效。
  if (level === "unrestricted") {
    try {
      await ElMessageBox.confirm(
        "3级「完全放开」会关闭所有安全校验：不再限制命令只能访问会话工作目录，不再拦截环境变量展开、重定向越界等风险写法，且执行前不会再弹窗确认。" +
          "模型的每一条命令都会原样在你的电脑上真实执行，可能读写工作目录之外的任意文件。" +
          "只在你完全信任当前任务、且能自己承担后果时使用。确定要切换吗？",
        "切换到3级·完全放开",
        {
          confirmButtonText: "我已知情，确定切换",
          cancelButtonText: "取消",
          type: "warning",
          dangerouslyUseHTMLString: false,
          customClass: "unrestricted-confirm-box",
        }
      );
    } catch {
      return; // 用户取消，维持原权限级别不变
    }
  }
  try {
    await updateSessionPermission(currentSessionId.value, level);
    const s = sessions.value.find(s => s.sessionId === currentSessionId.value);
    if (s) s.permissionLevel = level;
    ElMessage.success(
      level === "auto" ? "已切换为2级：自动同意执行命令"
        : level === "unrestricted" ? "已切换为3级：完全放开，不再做任何校验"
        : "已切换为1级：执行命令需人工确认"
    );
  } catch (e) {
    ElMessage.error("设置权限级别失败：" + (e?.message || ""));
  }
}

// force=true：无条件滚到底部（新建会话/切换会话/用户发送消息时用）
// force=false：仅当用户当前贴底时才跟随滚动（流式输出过程中用，避免打断用户往上翻看）
function scrollBottom(force = false) {
  nextTick(() => {
    if (!listRef.value) return;
    if (!force && !stickToBottom.value) return;
    listRef.value.scrollTop = listRef.value.scrollHeight;
    stickToBottom.value = true;
    showScrollBtn.value = false;
  });
}

// 监听消息列表的滚动，判断用户是否手动往上翻看
function handleListScroll() {
  const el = listRef.value;
  if (!el) return;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  const nearBottom = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD;
  stickToBottom.value = nearBottom;
  showScrollBtn.value = !nearBottom;
}

async function loadSessions(autoSelect = false) {
  try {
    const res = await getAgentSessions();
    sessions.value = res.data || [];
    // 初次加载或指定 autoSelect 时，自动选中第一条（最近更新）
    if (autoSelect && sessions.value.length > 0 && !currentSessionId.value) {
      await selectSession(sessions.value[0]);
    }
  } catch {}
}

async function handleNewSession() {
  creatingSession.value = true;
  try {
    const res = await createAgentSession();
    await loadSessions();
    const found = sessions.value.find(s => s.sessionId === res.data.sessionId);
    if (found) {
      currentIndex.value = sessions.value.indexOf(found);
      await selectSession(found);
    }
  } catch { ElMessage.error("创建会话失败"); }
  finally { creatingSession.value = false; }
}

async function selectSession(session) {
  if (sending.value) stopGeneration();
  currentSessionId.value = session.sessionId;
  currentThreadId.value  = session.sessionId;
  currentIndex.value = sessions.value.indexOf(session);
  messages.value = [];
  try {
    const res = await getSessionMessages(session.sessionId);
    messages.value = (res.data || []).map(m => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
      files: m.files,
      thinking: false, thinkingContent: "", interrupted: false,
      steps: [], stepsExpanded: false,
    }));
  } catch {}
  scrollBottom(true);
}

async function handleDeleteSession(session) {
  try {
    await ElMessageBox.confirm("确定删除该会话？", "确认", {
      confirmButtonText: "删除", cancelButtonText: "取消", type: "warning",
    });
    const wasActive = currentSessionId.value === session.sessionId;
    await deleteAgentSession(session.sessionId);
    if (wasActive) {
      currentSessionId.value = "";
      messages.value = [];
    }
    await loadSessions(wasActive); // 删的是当前会话才自动跳到下一条
    ElMessage.success("已删除");
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────
// 聊天逻辑
// ─────────────────────────────────────────────────────────────────────────

// 接收 aiInput 组件的提交事件
async function handleSend(data) {
  const content = data.question?.trim();
  if (!content || sending.value || !currentSessionId.value) return;

  abortController = new AbortController();
  const uploadedDocs = (data.uploadedDocs || []).map(f => ({ filePath: f.filePath, type: f.type }));
  const files = uploadedDocs.map(f => f.filePath).join(",");

  messages.value.push({ role: "user", content, files, thinking: false, thinkingContent: "", interrupted: false, steps: [], stepsExpanded: false });
  messages.value.push({ role: "assistant", content: "", thinking: true, thinkingContent: "", interrupted: false, steps: [], stepsExpanded: false, todos: null });
  sending.value = true;
  scrollBottom(true);

  try {
    const resp = await fetch("http://localhost:5120/deepAgent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: content, session_id: currentSessionId.value, uploadedDocs, localChecked: data.localChecked, autoMode: true }),
      signal: abortController.signal,
    });

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";

    while (true) {
      if (abortController?.signal.aborted) { await reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) {
        sending.value = false;
        const last = messages.value[messages.value.length - 1];
        if (last?.role === "assistant") {
          last.thinking = false;
          if (!last.content && !last.interrupted) last.content = "❌ 请求失败，请检查模型配置后重试";
        }
        abortController = null;
        await loadSessions();
        scrollBottom();
        break;
      }

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop(); // 保留不完整的最后一行

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "DONE" || payload === "[DONE]") continue;
        try { handleStreamEvent(JSON.parse(payload)); } catch (e) { console.error("SSE解析错误:", e, line); }
      }
      scrollBottom();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const last = messages.value[messages.value.length - 1];
      if (last?.role === "assistant") { last.content = "请求失败，请重试"; last.thinking = false; }
    }
    sending.value = false;
    abortController = null;
  }
}

function handleStreamEvent(data) {
  const last = messages.value[messages.value.length - 1];
  if (!last || last.role !== "assistant") return;

  switch (data.type) {
    // 后端分配了本次请求的 thread_id（中断时 resume 需要它）
    case "thread_assigned":
      currentThreadId.value = data.thread_id;
      break;

    // 工具调用开始：用新数组替换（保证 Vue 3 响应性）
    case "tool_start": {
      const idx = messages.value.length - 1;
      messages.value[idx] = {
        ...messages.value[idx],
        steps: [...(messages.value[idx].steps || []), { tool: data.toolName, action: data.toolAction, status: "running" }],
      };
      break;
    }

    // 自主模式：新一轮续跑开始，插入分割线 marker
    case "auto_round": {
      const idx = messages.value.length - 1;
      messages.value[idx] = {
        ...messages.value[idx],
        steps: [...(messages.value[idx].steps || []), { tool: "__round__", round: data.round, status: "done" }],
      };
      break;
    }

    // 任务清单更新（write_todos 产出）
    case "todos_update": {
      const idx = messages.value.length - 1;
      messages.value[idx] = { ...messages.value[idx], todos: data.todos };
      break;
    }

    // 工具调用完成：更新最后一个 running → done
    case "tool_done": {
      const idx = messages.value.length - 1;
      const steps = [...(messages.value[idx].steps || [])];
      const ri = [...steps].reverse().findIndex(s => s.status === "running");
      if (ri !== -1) {
        steps[steps.length - 1 - ri] = { ...steps[steps.length - 1 - ri], status: "done" };
      } else {
        // 没有匹配到 running 步骤：多半是 task 委托的子 Agent 内部工具调用
        // （子 Agent 的执行不会经过 updates 流触发 tool_start，只有 tool_done），
        // 直接补一条已完成的步骤，避免子 Agent 内部的操作在页面上被无声丢弃
        steps.push({ tool: data.toolName, status: "done" });
      }
      messages.value[idx] = { ...messages.value[idx], steps };
      break;
    }

    // 正式回答内容
    case "message_stream":
      if (data.content) {
        const idx = messages.value.length - 1;
        messages.value[idx] = {
          ...messages.value[idx],
          thinking: false,
          content: (messages.value[idx].content || "") + data.content,
        };
      }
      break;

    // 人工审批中断
    case "thinking_stream":
      if (data.content) {
        const idx = messages.value.length - 1;
        messages.value[idx] = {
          ...messages.value[idx],
          thinkingContent: (messages.value[idx].thinkingContent || "") + data.content,
        };
      }
      break;

    case "interrupt": {
      const value = data.interruptData?.value;
      const idx = messages.value.length - 1;
      if (value?.kind === "browser_blocked") {
        messages.value[idx] = {
          ...messages.value[idx],
          thinking: false,
          content: value.message || "浏览器操作需要您手动处理后才能继续",
          interrupted: true,
          interruptKind: "browser_blocked",
          interruptScreenshot: value.screenshot || null,
        };
      } else {
        const requests = value?.actionRequests || [];
        const req = requests[0];
        const dedup = value?.dedupMatch || null;
        // 单个请求的展示文案（含 create_skill 正文预览），供下面单请求/多请求两种情况复用
        const describeRequest = (r) => {
          const previewSource = r.name === "create_skill" ? r.args?.content : null;
          const preview = previewSource
            ? `\n\n--- 内容预览 ---\n${String(previewSource).slice(0, 800)}${previewSource.length > 800 ? "\n...(已截断)" : ""}`
            : "";
          return `需要执行：**${r.name}**\n\n${r.description || ""}${preview}`;
        };
        let content;
        let interruptRows = null;
        if (dedup) {
          content = `检测到与已有 Skill「${dedup.targetDisplayName || dedup.targetName}」相似，为避免创建重复 Skill，请选择处理方式：\n\n` +
            `**新内容用途**：${dedup.proposedDescription || req?.description || "（未填写）"}\n` +
            `**已有 Skill 用途**：${dedup.targetDescription || "（未填写）"}`;
        } else if (requests.length > 1) {
          // 模型这一轮同时发起了多个待审批调用——不能只给一个"整批同意/整批拒绝"，用户应该能
          // 分别看清楚每一条并单独决定。content 只放一句概述，具体每一条走下面的 interruptRows，
          // 由模板渲染成可交互的逐条同意/拒绝列表。
          content = `模型这一轮同时请求执行 **${requests.length}** 个操作，请对每一条分别确认：`;
          interruptRows = requests.map((r) => ({ name: r.name, text: describeRequest(r), decision: null }));
        } else if (req) {
          content = describeRequest(req);
        } else {
          content = "需要您的确认才能继续执行";
        }
        messages.value[idx] = {
          ...messages.value[idx],
          thinking: false,
          content,
          interrupted: true,
          interruptKind: "approval",
          interruptScreenshot: null,
          interruptDedup: dedup,
          interruptRows,
          // 模型有时会在同一轮里发起多个需要审批的工具调用（如两次 run_command），
          // LangGraph resume 时必须传回同样数量的 decisions，数量对不上会直接报错
          // "Number of human decisions does not match number of hanging tool calls"。
          // interruptRows 存在时走逐条提交（submitRowDecisions），否则走这里的整批提交，
          // 按这个数量把同一个决定复制够份数一起交给 resumeChat。
          interruptActionRequestCount: value?.actionRequests?.length || 1,
        };
      }
      currentThreadId.value = data.thread_id;
      sending.value = false;
      break;
    }

    case "skill_review_request": {
      const review = { ...data, status: "pending" };
      currentThreadId.value = data.thread_id || currentThreadId.value;
      const idx = messages.value.length - 1;
      if (idx >= 0 && messages.value[idx]?.role === "assistant") {
        messages.value[idx] = { ...messages.value[idx], skillReview: review };
      } else {
        pendingSkillReview.value = review;
      }
      break;
    }

    case "error": {
      const idx = messages.value.length - 1;
      const msg = friendlyError(data.error);
      messages.value[idx] = {
        ...messages.value[idx],
        thinking: false,
        content: `❌ ${msg}`,
        isError: true,
      };
      sending.value = false;
      ElMessage.error({ message: msg, duration: 5000 });
      break;
    }
  }
}

// 将常见英文错误转为友好中文提示
function friendlyError(raw = "") {
  if (/unexpected item type in content|invalid.*content.*type|image_url.*not.*support|does not support.*image/i.test(raw)) return "当前模型不支持图片输入，请更换支持视觉的模型后重试，或不要上传图片";
  if (/429|quota|rate.?limit|billing/i.test(raw)) return "API 配额不足或请求过于频繁，请检查账号余额后重试";
  if (/401|unauthorized|invalid.?key/i.test(raw)) return "API Key 无效，请前往模型配置页面检查";
  if (/403|forbidden/i.test(raw)) return "无权限访问该模型，请检查 API Key 或套餐";
  if (/5\d\d|internal.?error|server.?error/i.test(raw)) return "模型服务异常，请稍后重试";
  if (/timeout|timed.?out/i.test(raw)) return "请求超时，请稍后重试";
  if (/network|connect/i.test(raw)) return "网络连接失败，请检查网络后重试";
  return raw || "未知错误，请稍后重试";
}

// 提交审批决定的共用逻辑：resumeChat（整批同一个决定）和 submitRowDecisions（逐条决定）都走这里，
// decisions 数组的长度必须和这一轮挂起的工具调用数一致，否则 LangGraph resume 会报数量不匹配的错误。
async function submitDecisions(decisions) {
  if (sending.value) return;
  const last = messages.value[messages.value.length - 1];
  if (last?.interrupted) last.interrupted = false;

  abortController = new AbortController();
  messages.value.push({ role: "assistant", content: "", thinking: true, thinkingContent: "", interrupted: false, steps: [], stepsExpanded: false });
  sending.value = true;
  scrollBottom(true);

  try {
    const resp = await fetch("http://localhost:5120/deepAgent/chat/resume", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: currentThreadId.value,
        session_id: currentSessionId.value,
        decisions,
      }),
      signal: abortController.signal,
    });

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";

    while (true) {
      if (abortController?.signal.aborted) { await reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) {
        sending.value = false;
        const last2 = messages.value[messages.value.length - 1];
        if (last2?.role === "assistant") last2.thinking = false;
        abortController = null;
        scrollBottom();
        break;
      }
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "DONE" || payload === "[DONE]") continue;
        try { handleStreamEvent(JSON.parse(payload)); } catch (e) { console.error("SSE解析错误:", e, line); }
      }
      scrollBottom();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const last2 = messages.value[messages.value.length - 1];
      if (last2?.role === "assistant") { last2.content = "请求失败"; last2.thinking = false; }
    }
    sending.value = false;
    abortController = null;
  }
}

// 单一决定（同意/拒绝/换个方式/继续）对这一轮挂起的所有工具调用一视同仁——
// browser_blocked、Skill 去重、以及只有 1 个待审批调用时都走这条路径
async function resumeChat(decision) {
  const last = messages.value[messages.value.length - 1];
  const decisionCount = last?.interruptActionRequestCount || 1;
  await submitDecisions(Array.from({ length: decisionCount }, () => ({ type: decision })));
}

// 逐条审批：每个挂起的工具调用各自的同意/拒绝状态，凑齐后一次性提交
async function setRowDecision(index, decision) {
  const rows = interruptedMessage.value?.interruptRows;
  if (!rows?.[index]) return;
  rows[index].decision = decision;
}

function setAllRowDecisions(decision) {
  const rows = interruptedMessage.value?.interruptRows;
  if (!rows) return;
  rows.forEach((row) => { row.decision = decision; });
}

const allInterruptRowsDecided = computed(() => {
  const rows = interruptedMessage.value?.interruptRows;
  return !!rows?.length && rows.every((row) => row.decision === "approve" || row.decision === "reject");
});

async function submitRowDecisions() {
  const rows = interruptedMessage.value?.interruptRows;
  if (!rows?.length || !allInterruptRowsDecided.value) return;
  await submitDecisions(rows.map((row) => ({ type: row.decision })));
}

// create_skill 命中去重、用户选择"合并"：不走 approve/reject，直接调专门的合并接口——
// 服务端会自己把两份内容合成一份写回已有 Skill，不需要模型再调用任何工具
async function mergeSkill() {
  if (sending.value) return;
  const last = messages.value[messages.value.length - 1];
  if (last?.interrupted) last.interrupted = false;

  abortController = new AbortController();
  messages.value.push({ role: "assistant", content: "", thinking: true, thinkingContent: "", interrupted: false, steps: [], stepsExpanded: false });
  sending.value = true;
  scrollBottom(true);

  try {
    const resp = await fetch("http://localhost:5120/deepAgent/chat/skill-merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: currentThreadId.value,
        session_id: currentSessionId.value,
      }),
      signal: abortController.signal,
    });

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";

    while (true) {
      if (abortController?.signal.aborted) { await reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) {
        sending.value = false;
        const last2 = messages.value[messages.value.length - 1];
        if (last2?.role === "assistant") last2.thinking = false;
        abortController = null;
        scrollBottom();
        break;
      }
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "DONE" || payload === "[DONE]") continue;
        try { handleStreamEvent(JSON.parse(payload)); } catch (e) { console.error("SSE解析错误:", e, line); }
      }
      scrollBottom();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const last2 = messages.value[messages.value.length - 1];
      if (last2?.role === "assistant") { last2.content = "Skill 合并失败，请重试"; last2.thinking = false; }
    }
    sending.value = false;
    abortController = null;
  }
}

function skipSkillReview(msg) {
  if (!msg?.skillReview || msg.skillReview.status !== "pending") return;
  msg.skillReview = { ...msg.skillReview, status: "skipped" };
}

async function confirmSkillReview(msg) {
  if (!msg?.skillReview || msg.skillReview.status !== "pending" || sending.value) return;
  const review = msg.skillReview;
  msg.skillReview = { ...review, status: "running" };
  pendingSkillReview.value = null;
  await startSkillReview(review);
}

async function startSkillReview(review) {
  if (sending.value) return;
  currentThreadId.value = review.thread_id || currentThreadId.value;

  abortController = new AbortController();
  messages.value.push({
    role: "assistant",
    content: "",
    thinking: true,
    thinkingContent: "",
    interrupted: false,
    steps: [],
    stepsExpanded: false,
  });
  sending.value = true;
  scrollBottom(true);

  try {
    const resp = await fetch("http://localhost:5120/deepAgent/chat/skill-review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        thread_id: currentThreadId.value,
        session_id: currentSessionId.value,
      }),
      signal: abortController.signal,
    });

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let lineBuffer = "";

    while (true) {
      if (abortController?.signal.aborted) { await reader.cancel(); break; }
      const { done, value } = await reader.read();
      if (done) {
        sending.value = false;
        const last = messages.value[messages.value.length - 1];
        if (last?.role === "assistant") {
          last.thinking = false;
          if (!last.content && !last.interrupted) last.content = "Skill 沉淀流程已完成。";
        }
        abortController = null;
        scrollBottom();
        break;
      }

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload || payload === "DONE" || payload === "[DONE]") continue;
        try { handleStreamEvent(JSON.parse(payload)); } catch (e) { console.error("SSE解析错误:", e, line); }
      }
      scrollBottom();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      const last = messages.value[messages.value.length - 1];
      if (last?.role === "assistant") { last.content = "Skill 沉淀失败，请重试"; last.thinking = false; }
    }
    sending.value = false;
    abortController = null;
  }
}

function stopGeneration() {
  if (!abortController) return;
  abortController.abort();
  abortController = null;
  sending.value = false;
  const last = messages.value[messages.value.length - 1];
  if (last?.role === "assistant") {
    last.thinking = false;
    if (!last.content) last.content = "（已停止生成）";
  }
}

function renderInterrupt(content) {
  return content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

// ─── Skills 创建 ──────────────────────────────────────────────────────────
async function handleCreateSkill() {
  if (!newSkill.name.trim()) { ElMessage.warning("请输入目录名"); return; }
  creatingSkill.value = true;
  try {
    await createSkill({ ...newSkill });
    createSkillDialog.value = false;
    Object.assign(newSkill, { name: "", displayName: "", description: "" });
    ElMessage.success("Skill 已创建");
  } catch (e) { ElMessage.error("创建失败"); }
  finally { creatingSkill.value = false; }
}

// ─── 生命周期 ─────────────────────────────────────────────────────────────
onMounted(() => loadSessions(true));
// 页面被 keep-alive 缓存后，onMounted 只在首次创建时触发；
// 每次切回该页面时用 onActivated 刷新会话列表，不强制切换当前选中的会话
onActivated(() => loadSessions());
onUnmounted(() => { if (abortController) abortController.abort(); });
</script>

<style scoped lang="scss">
/* === 整体容器（与 AI 助手完全一致） === */
.agent-page {
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
  color: #0f172a;
}

.session-list {
  padding: 0 5px;
  flex: 1;
  overflow-y: auto;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  gap: 8px;
  cursor: pointer;
  border-radius: 16px;
  transition: all 0.35s ease;
  position: relative;

  &:hover .del { display: block; }
  &.active { background: rgba(56, 189, 248, 0.12); }
}

.del {
  display: none;
}

.session-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-preview {
  font-size: 14px;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
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

.workdir-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #64748b;
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px dashed rgba(15, 23, 42, 0.08);
}

.workdir-label { color: #94a3b8; flex-shrink: 0; }
.workdir-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}

.workdir-change {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  cursor: pointer;
  color: #38bdf8;
  padding: 2px 6px;
  border-radius: 6px;
  &:hover { background: rgba(56, 189, 248, 0.1); }
}

.inline-loading {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 8px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 20px;
  padding: 2px 8px;
  vertical-align: middle;
}

.loading-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #38bdf8;
  animation: dot-bounce 1.2s infinite ease-in-out;
}
.loading-dot:nth-child(2) { animation-delay: 0.2s; }
.loading-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1);   opacity: 1;   }
}

.loading-text {
  font-size: 11px;
  color: #38bdf8;
  font-weight: 500;
  margin-left: 3px;
}

/* === 消息列表 === */
.bubble-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 10px;
}

.scroll-bottom-btn {
  position: absolute;
  bottom: 200px;
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

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.bubble {
  border-radius: 16px;
  padding: 20px;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transition: all 0.35s ease;
  position: relative;
}

/* AI 消息 */
.ai-wrap {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.content {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: #0f172a;
  word-break: break-word;
  overflow-wrap: break-word;
  line-height: 25px;
}

.options {
  display: flex;
  justify-content: flex-end;
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

.skill-review-summary {
  max-height: 96px;
  overflow-y: auto;
  margin-top: 10px;
  padding: 10px 12px;
  color: #334155;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
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

.copy {
  cursor: pointer;
  display: flex;
  align-items: center;
  color: #64748b;
  font-size: 13px;
  gap: 4px;
  &:hover { color: #409eff; }
}

/* 中断（消息流里的记录） */
.interrupt-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #d97706;
  margin-bottom: 8px;
}

/* 中断审批浮层：右下角常驻卡片 */
.interrupt-toast {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 440px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2), 0 0 0 1px rgba(15, 23, 42, 0.06);
  padding: 18px;
  z-index: 3000;
}

.interrupt-toast-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #d97706;
  margin-bottom: 12px;
  flex-shrink: 0;
}

.interrupt-toast-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  margin-bottom: 16px;
}

.interrupt-toast-body {
  font-size: 13px;
  color: #334155;
  line-height: 22px;
  word-break: break-word;

  :deep(strong) { color: #0f172a; }
}

.interrupt-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.interrupt-row {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  padding: 10px 12px;
  background: #f8fafc;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.interrupt-row.is-approved {
  border-color: #93c5fd;
  background: #f5f9ff;
}

.interrupt-row.is-rejected {
  border-color: #fca5a5;
  background: #fef2f2;
}

.interrupt-row-index {
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
}

.interrupt-row-text {
  font-size: 13px;
  color: #334155;
  line-height: 20px;
  word-break: break-word;
  margin-bottom: 8px;

  :deep(strong) { color: #0f172a; }
}

.interrupt-row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.interrupt-toast-screenshot {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  margin-bottom: 16px;
  flex-shrink: 0;
}

.interrupt-toast-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.interrupt-toast-fade-enter-active,
.interrupt-toast-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.interrupt-toast-fade-enter-from,
.interrupt-toast-fade-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

/* 用户消息 */
.humanUser {
  display: flex;
  justify-content: flex-end;
}

.right {
  display: flex;
  align-items: flex-start;
  gap: 10px;

  .content {
    margin-right: 0;
    color: blue;
    font-weight: 600;
    white-space: pre-wrap;
    word-break: break-word;
  }
}

/* 任务清单（自主模式） */
.todos-wrap {
  margin-bottom: 8px;
  padding: 8px 10px;
  background: #f8fafc;
  border-radius: 8px;
  border-left: 3px solid #6366f1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #94a3b8;

  &.in_progress { color: #38bdf8; font-weight: 600; }
  &.completed { color: #475569; text-decoration: line-through; }
}

.todo-icon { flex-shrink: 0; }

/* 自动续跑分割线 */
.round-marker {
  margin: 4px 0;
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
}

/* 执行步骤 */
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

.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #94a3b8;

  .step-item.running & {
    background: #38bdf8;
    animation: pulse-dot 1s infinite;
  }
  .step-item.done & {
    background: #22c55e;
  }
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

.thinking-sm {
  font-size: 12px;
  padding: 2px 0;
}

.thinking-text {
  font-size: 12px;
  color: #64748b;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  padding: 2px 0;
  font-weight: normal;
  animation: none;
}

/* 思考动画 */
.thinking {
  padding: 4px 0;
  display: inline-block;
  animation: bounce 1.5s infinite;
  font-weight: 600;
  color: #409eff;
  font-size: 14px;

  span { animation: dotBlink 1.5s infinite; }
  span:nth-child(1) { animation-delay: 0s; }
  span:nth-child(2) { animation-delay: 0.3s; }
  span:nth-child(3) { animation-delay: 0.6s; }
}

@keyframes dotBlink {
  0%, 100% { opacity: 0; }
  50%       { opacity: 1; }
}

@keyframes bounce {
  0%, 20%, 50%, 80%, 100% { transform: translateY(0); }
  40%  { transform: translateY(-10px); }
  60%  { transform: translateY(-5px); }
}

/* === 输入区（与 aiInput.vue 完全一致） === */
.footer {
  padding: 10px;
  margin-top: 12px;
  width: 100%;
  background: #ffffff;
  border-radius: 10px;
  border: 1px solid #c9dbf3;
  box-sizing: border-box;

  /* 修复全局深色主题污染 */
  :deep(.el-textarea__inner) {
    background-color: white !important;
    color: black !important;
    box-shadow: none !important;
  }
}

.quiz-operation {
  width: 100%;
  height: 36px;
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  &-left {
    display: flex;
    align-items: center;
  }

  &-right {
    display: flex;
    align-items: center;

    .submit {
      height: 32px;
      width: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stop-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #409eff;
      display: flex;
      align-items: center;
      justify-content: center;

      span {
        display: block;
        width: 12px;
        height: 12px;
        background: #fff;
        border-radius: 2px;
      }
    }
  }
}

/* === Avatar 颜色 === */
:deep(.el-avatar.ai)   { background: #38bdf8; }
:deep(.el-avatar.user) { background: #6366f1; }

/* === Glow 效果 === */
.glow {
  position: relative;
  &::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: 16px;
    background: radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 60%);
    pointer-events: none;
  }
}

.glow-panel { position: relative; }

/* === 滚动条 === */
.session-list::-webkit-scrollbar,
.bubble-list::-webkit-scrollbar {
  width: 6px;
}
.session-list::-webkit-scrollbar-thumb,
.bubble-list::-webkit-scrollbar-thumb {
  background-color: rgba(56, 189, 248, 0.3);
  border-radius: 3px;
}
.session-list::-webkit-scrollbar-track,
.bubble-list::-webkit-scrollbar-track {
  background: transparent;
}
</style>

<!--
  ElMessageBox.confirm() 挂载出来的 DOM 直接 append 到 <body>，脱离本组件的渲染树，
  上面 <style scoped> 里的类选不到它，必须写在不带 scoped 的样式块里。
-->
<style>
.unrestricted-confirm-box {
  background: #ffffff !important;
  border: 1px solid #fecaca !important;
  border-radius: 16px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15) !important;
}
.unrestricted-confirm-box .el-message-box__title { color: #1f2937 !important; font-weight: 600; }
.unrestricted-confirm-box .el-message-box__message { color: #4b5563 !important; line-height: 1.7; }
.unrestricted-confirm-box .el-message-box__status { color: #dc2626 !important; }
.unrestricted-confirm-box .el-message-box__headerbtn .el-message-box__close { color: #9ca3af !important; }
.unrestricted-confirm-box .el-message-box__btns .el-button {
  background: #ffffff !important; border: 1px solid #d1d5db !important; color: #4b5563 !important;
}
.unrestricted-confirm-box .el-message-box__btns .el-button:hover {
  border-color: #9ca3af !important; color: #1f2937 !important;
}
.unrestricted-confirm-box .el-message-box__btns .el-button--primary {
  background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%) !important;
  border: none !important; color: #fff !important;
  box-shadow: 0 4px 15px rgba(239, 68, 68, 0.35) !important;
}
</style>
