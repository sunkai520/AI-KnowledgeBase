<template>
  <div class="scheduled-task-page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="任务仅在应用运行期间（含最小化到托盘）触发；完全退出应用后不会触发，也不会补跑错过的任务。"
      style="margin-bottom: 16px"
    />

    <div class="toolbar">
      <el-button type="primary" @click="openCreateDialog">新建任务</el-button>
      <el-button @click="loadList" :loading="loading">刷新</el-button>
    </div>

    <el-table :data="pagedTasks" v-loading="loading" style="width: 100%" max-height="420">
      <el-table-column prop="name" label="任务名" min-width="130" />
      <el-table-column label="调度规则" min-width="140">
        <template #default="{ row }">
          <span v-if="row.scheduleType === 'interval'">每隔 {{ row.intervalMinutes }} 分钟</span>
          <span v-else>每天 {{ row.dailyTime }}</span>
        </template>
      </el-table-column>
      <el-table-column label="命令执行" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.allowCommandExecution" type="warning" size="small">已开启</el-tag>
          <span v-else class="never-run">—</span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="90">
        <template #default="{ row }">
          <el-switch :model-value="!!row.enabled" @change="(val) => onToggle(row, val)" />
          <div v-if="row.consecutiveFailures >= 3 && !row.enabled" class="circuit-broken">已停用</div>
        </template>
      </el-table-column>
      <el-table-column label="下次执行" min-width="130">
        <template #default="{ row }">{{ formatTime(row.nextRunAt) }}</template>
      </el-table-column>
      <el-table-column label="最近执行" min-width="160">
        <template #default="{ row }">
          <template v-if="row.isRunning">
            <span class="running-badge">
              <el-icon class="is-loading"><Loading /></el-icon><span>执行中</span>
            </span>
          </template>
          <template v-else-if="row.lastRunAt">
            <el-tag :type="row.lastStatus === 'success' ? 'success' : 'danger'" size="small">
              {{ row.lastStatus === "success" ? "成功" : "失败" }}
            </el-tag>
            <span class="last-time">{{ formatTime(row.lastRunAt) }}</span>
            <div class="last-detail" :title="row.lastStatus === 'success' ? row.lastResult : row.lastError">
              {{ row.lastStatus === "success" ? row.lastResult : row.lastError }}
            </div>
          </template>
          <span v-else class="never-run">尚未执行</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="190" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button
              circle
              size="small"
              :icon="VideoPlay"
              :loading="row.isRunning || runningIds.has(row.id)"
              :disabled="row.isRunning"
              title="立即执行"
              @click="onRunNow(row)"
            />
            <el-button circle size="small" :icon="Document" title="执行详情" @click="openDetail(row)" />
            <el-button circle size="small" :icon="FolderOpened" title="打开工作目录" @click="openWorkDir(row)" />
            <el-button circle size="small" :icon="Edit" title="编辑" @click="openEditDialog(row)" />
            <el-button circle size="small" type="danger" :icon="Delete" title="删除" @click="onDelete(row)" />
          </div>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="tasks.length"
      v-model:current-page="currentPage"
      :page-size="pageSize"
      :total="tasks.length"
      layout="total, prev, pager, next"
      style="margin-top: 12px; justify-content: flex-end"
    />

    <!-- 新建/编辑任务 -->
    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑任务' : '新建任务'" width="560px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="任务名">
          <el-input v-model="form.name" placeholder="给任务起个名字" />
        </el-form-item>
        <el-form-item label="指令内容">
          <el-input
            v-model="form.instruction"
            type="textarea"
            :rows="4"
            placeholder="到点后会把这段内容发给 AI 执行，模型可以在工作目录内读写文件，例如：把今天的新闻摘要写成 report.md"
          />
        </el-form-item>
        <el-form-item label="调度方式">
          <el-radio-group v-model="form.scheduleType">
            <el-radio label="interval">每隔一段时间</el-radio>
            <el-radio label="daily">每天固定时间</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="间隔分钟" v-if="form.scheduleType === 'interval'">
          <el-input-number v-model="form.intervalMinutes" :min="form.allowCommandExecution ? 5 : 1" :max="10080" />
          <div class="tip" v-if="form.allowCommandExecution">已开启命令执行，最小间隔限制为 5 分钟</div>
        </el-form-item>
        <el-form-item label="执行时间" v-else>
          <el-time-picker v-model="form.dailyTime" format="HH:mm" value-format="HH:mm" placeholder="选择每天执行的时间" />
        </el-form-item>
        <el-form-item label="工作目录">
          <div class="row-with-btn">
            <el-input :model-value="form.workDir" readonly placeholder="留空则自动分配一个专属目录" />
            <el-button @click="onSelectWorkDir">选择</el-button>
            <el-button v-if="form.workDir" @click="form.workDir = ''">清除</el-button>
          </div>
          <div class="tip">模型读写文件、执行命令都限定在这个目录内，生成的文档也会落在这里</div>
        </el-form-item>
        <el-form-item label="允许执行命令">
          <el-switch v-model="form.allowCommandExecution" @change="onToggleAllowCommand" />
          <el-alert
            v-if="form.allowCommandExecution"
            type="warning"
            :closable="false"
            show-icon
            style="margin-top: 8px"
            title="命令会在无人确认的情况下自动执行（限定在工作目录内、有危险命令拦截和超时保护），请确保指令内容可信"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="onSubmit" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>

    <!-- 执行详情 -->
    <el-dialog v-model="detailVisible" title="执行详情" width="720px">
      <div class="notes-section">
        <div class="notes-header">
          <span>已积累经验</span>
          <span class="tip">跑过的任务会自动总结成经验，下次执行时参考，减少重复踩坑；也可以自己手动编辑</span>
        </div>
        <el-input
          v-model="learnedNotesDraft"
          type="textarea"
          :rows="5"
          placeholder="还没有积累任何经验，会在任务执行过一次之后自动生成，也可以现在就手动填写"
        />
        <div class="notes-actions">
          <el-button size="small" @click="onClearLearnedNotes">清空</el-button>
          <el-button size="small" type="primary" :loading="savingNotes" @click="onSaveLearnedNotes">保存</el-button>
        </div>
      </div>
      <el-divider />
      <div class="detail-layout">
        <div class="run-list">
          <div
            v-for="run in runs"
            :key="run.id"
            :class="['run-item', { active: selectedRunId === run.id }]"
            @click="selectRun(run.id)"
          >
            <el-tag :type="run.status === 'success' ? 'success' : run.status === 'fail' ? 'danger' : 'info'" size="small">
              {{ run.status === "success" ? "成功" : run.status === "fail" ? "失败" : "执行中" }}
            </el-tag>
            <span class="run-time">{{ formatTime(run.startedAt) }}</span>
          </div>
          <div v-if="!runs.length" class="empty-tip">还没有执行记录</div>
        </div>
        <div class="step-timeline" v-loading="loadingSteps">
          <div v-for="step in steps" :key="step.id" class="step-item">
            <div class="step-header">
              <el-tag size="small" :type="stepTagType(step.eventType)">{{ stepTypeLabel(step.eventType) }}</el-tag>
              <span v-if="step.toolName" class="step-tool">{{ step.toolName }}</span>
            </div>
            <div class="step-content">{{ step.content }}</div>
          </div>
          <div v-if="!steps.length && selectedRunId" class="empty-tip">没有记录到执行步骤</div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { VideoPlay, Document, FolderOpened, Edit, Delete, Loading } from "@element-plus/icons-vue";

const tasks = ref([]);
const loading = ref(false);
const runningIds = ref(new Set());
const dialogVisible = ref(false);
const submitting = ref(false);
const editingId = ref(null);
const currentPage = ref(1);
const pageSize = ref(10);
const pagedTasks = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return tasks.value.slice(start, start + pageSize.value);
});
let unsubscribe = null;

// 详情弹窗
const detailVisible = ref(false);
const detailTaskId = ref(null);
const runs = ref([]);
const selectedRunId = ref(null);
const steps = ref([]);
const loadingSteps = ref(false);
const learnedNotesDraft = ref("");
const savingNotes = ref(false);

const form = reactive({
  name: "",
  instruction: "",
  scheduleType: "interval",
  intervalMinutes: 60,
  dailyTime: "09:00",
  workDir: "",
  allowCommandExecution: false,
});

function formatTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function stepTypeLabel(type) {
  return (
    { tool_call: "调用工具", tool_result: "工具结果", final: "最终结果", error: "出错", warning: "提醒" }[type] || type
  );
}
function stepTagType(type) {
  return { tool_call: "primary", tool_result: "info", final: "success", error: "danger", warning: "warning" }[type] || "info";
}

async function loadList() {
  loading.value = true;
  try {
    tasks.value = await window.electronAPI.scheduledTaskList();
    const maxPage = Math.max(1, Math.ceil(tasks.value.length / pageSize.value));
    if (currentPage.value > maxPage) currentPage.value = maxPage;
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  form.name = "";
  form.instruction = "";
  form.scheduleType = "interval";
  form.intervalMinutes = 60;
  form.dailyTime = "09:00";
  form.workDir = "";
  form.allowCommandExecution = false;
  editingId.value = null;
}

function openCreateDialog() {
  resetForm();
  dialogVisible.value = true;
}

function openEditDialog(row) {
  editingId.value = row.id;
  form.name = row.name;
  form.instruction = row.instruction;
  form.scheduleType = row.scheduleType;
  form.intervalMinutes = row.intervalMinutes || 60;
  form.dailyTime = row.dailyTime || "09:00";
  form.workDir = row.workDir || "";
  form.allowCommandExecution = !!row.allowCommandExecution;
  dialogVisible.value = true;
}

async function onSelectWorkDir() {
  const dir = await window.electronAPI.selectScheduledTaskWorkDir();
  if (dir) form.workDir = dir;
}

async function onToggleAllowCommand(val) {
  if (!val) return;
  try {
    await ElMessageBox.confirm(
      "开启后，模型执行这个任务时可以在工作目录内运行 shell 命令，且不会弹窗等你确认（无人值守自动执行）。虽然限定了目录范围并拦截了高危命令，但仍有真实风险，请确保任务指令内容可信。",
      "风险确认",
      { type: "warning", confirmButtonText: "我已了解，继续开启", cancelButtonText: "取消" }
    );
  } catch {
    form.allowCommandExecution = false;
  }
}

async function onSubmit() {
  if (!form.name.trim()) {
    ElMessage.warning("请填写任务名");
    return;
  }
  if (!form.instruction.trim()) {
    ElMessage.warning("请填写指令内容");
    return;
  }
  submitting.value = true;
  try {
    const payload = {
      name: form.name.trim(),
      instruction: form.instruction.trim(),
      scheduleType: form.scheduleType,
      intervalMinutes: form.scheduleType === "interval" ? form.intervalMinutes : null,
      dailyTime: form.scheduleType === "daily" ? form.dailyTime : null,
      workDir: form.workDir || null,
      allowCommandExecution: form.allowCommandExecution,
    };
    if (editingId.value) {
      await window.electronAPI.scheduledTaskUpdate(editingId.value, payload);
    } else {
      await window.electronAPI.scheduledTaskCreate(payload);
    }
    dialogVisible.value = false;
    await loadList();
    ElMessage.success("保存成功");
  } finally {
    submitting.value = false;
  }
}

async function onToggle(row, val) {
  await window.electronAPI.scheduledTaskToggle(row.id, val);
  await loadList();
}

async function onRunNow(row) {
  if (row.isRunning || runningIds.value.has(row.id)) return;
  runningIds.value.add(row.id);
  row.isRunning = true;
  try {
    await window.electronAPI.scheduledTaskRunNow(row.id);
    ElMessage.success("执行完成");
    await loadList();
  } catch (e) {
    ElMessage.error(e?.message || "执行失败");
    await loadList();
  } finally {
    runningIds.value.delete(row.id);
  }
}

async function onDelete(row) {
  await ElMessageBox.confirm(`确定删除任务「${row.name}」？`, "提示", { type: "warning" });
  await window.electronAPI.scheduledTaskDelete(row.id);
  await loadList();
}

async function openWorkDir(row) {
  if (!row.workDir) {
    ElMessage.info("这个任务用的是自动分配的默认工作目录，还没有手动指定过路径，先执行一次后会自动创建");
    return;
  }
  const res = await window.electronAPI.openPath(row.workDir);
  if (!res?.success) ElMessage.error(`打开失败：${res?.error || "未知错误"}`);
}

async function openDetail(row) {
  detailTaskId.value = row.id;
  detailVisible.value = true;
  selectedRunId.value = null;
  steps.value = [];
  learnedNotesDraft.value = row.learnedNotes || "";
  runs.value = await window.electronAPI.scheduledTaskListRuns(row.id);
  if (runs.value.length) selectRun(runs.value[0].id);
}

function syncLearnedNotesToRow(notes) {
  const row = tasks.value.find((t) => t.id === detailTaskId.value);
  if (row) row.learnedNotes = notes;
}

async function onSaveLearnedNotes() {
  savingNotes.value = true;
  try {
    await window.electronAPI.scheduledTaskUpdateLearnedNotes(detailTaskId.value, learnedNotesDraft.value || null);
    syncLearnedNotesToRow(learnedNotesDraft.value || null);
    ElMessage.success("已保存");
  } finally {
    savingNotes.value = false;
  }
}

async function onClearLearnedNotes() {
  await ElMessageBox.confirm("确定清空这个任务积累的经验吗？", "提示", { type: "warning" });
  learnedNotesDraft.value = "";
  await window.electronAPI.scheduledTaskUpdateLearnedNotes(detailTaskId.value, null);
  syncLearnedNotesToRow(null);
  ElMessage.success("已清空");
}

async function selectRun(runId) {
  selectedRunId.value = runId;
  loadingSteps.value = true;
  try {
    steps.value = await window.electronAPI.scheduledTaskGetRunSteps(runId);
  } finally {
    loadingSteps.value = false;
  }
}

onMounted(() => {
  loadList();
  unsubscribe = window.electronAPI.onScheduledTaskUpdate((payload) => {
    const row = tasks.value.find((t) => t.id === payload.id);
    if (row) Object.assign(row, payload);
    if (payload.autoDisabled) {
      ElMessage.warning(`任务「${row?.name || ""}」连续失败已自动停用，请检查后重新启用`);
    }
  });
});
onBeforeUnmount(() => {
  unsubscribe?.();
});
</script>

<style scoped lang="scss">
.scheduled-task-page {
  width: 100%;
}
.toolbar {
  margin-bottom: 12px;
  display: flex;
  gap: 10px;
}
.last-time {
  margin-left: 6px;
  color: #64748b;
  font-size: 12px;
}
.last-detail {
  font-size: 12px;
  color: #94a3b8;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.never-run {
  color: #94a3b8;
  font-size: 12px;
}
.circuit-broken {
  color: #fca5a5;
  font-size: 11px;
  margin-top: 2px;
}
.running-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  background: rgba(217, 119, 6, 0.15);
  border: 1px solid rgba(217, 119, 6, 0.3);
  color: #fbbf24;

  .el-icon {
    display: inline-flex;
    font-size: 12px;
  }
}
.row-actions {
  display: flex;
  gap: 6px;
  flex-wrap: nowrap;
}
.row-with-btn {
  display: flex;
  width: 100%;
  gap: 8px;
  align-items: center;
}
.tip {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
  line-height: 1.6;
}
.notes-section {
  margin-bottom: 4px;
}
.notes-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 8px;
  span:first-child {
    font-size: 14px;
    font-weight: 600;
    color: #e2e8f0;
  }
}
.notes-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.detail-layout {
  display: flex;
  gap: 16px;
  height: 420px;
}
.run-list {
  width: 180px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  padding-right: 10px;
}
.run-item {
  padding: 8px 6px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
  &:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  &.active {
    background: rgba(56, 189, 248, 0.12);
  }
}
.run-time {
  font-size: 12px;
  color: #94a3b8;
}
.step-timeline {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}
.step-item {
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.step-tool {
  font-size: 12px;
  color: #94a3b8;
}
.step-content {
  font-size: 12px;
  color: #cbd5e1;
  white-space: pre-wrap;
  word-break: break-all;
}
.empty-tip {
  color: #94a3b8;
  font-size: 12px;
  text-align: center;
  padding: 20px 0;
}

/* ── Element Plus 暗色覆盖：跟系统配置页保持一致的深色玻璃风格 ── */
.scheduled-task-page {
  :deep(.el-alert--info) {
    background: rgba(56, 189, 248, 0.1);
    .el-alert__title,
    .el-alert__icon {
      color: #7dd3fc;
    }
  }
  :deep(.el-alert--warning) {
    background: rgba(217, 119, 6, 0.12);
    .el-alert__title,
    .el-alert__icon {
      color: #fbbf24;
    }
  }

  :deep(.el-button) {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
    margin-left: 0; // 覆盖 Element Plus 默认相邻按钮 12px 间距，改用 .row-actions 的 gap 统一控制
    &:hover {
      border-color: rgba(56, 189, 248, 0.4);
      color: #38bdf8;
    }
  }
  :deep(.el-button--primary) {
    background: linear-gradient(135deg, #38bdf8, #818cf8);
    border: none;
    color: #fff;
    &:hover {
      opacity: 0.85;
    }
  }
  :deep(.el-button--danger) {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    &:hover {
      background: rgba(239, 68, 68, 0.25);
    }
  }

  :deep(.el-table) {
    background: transparent;
    --el-table-bg-color: transparent;
    --el-table-tr-bg-color: transparent;
    --el-table-header-bg-color: rgba(255, 255, 255, 0.04);
    --el-table-border-color: rgba(255, 255, 255, 0.08);
    --el-table-text-color: #cbd5e1;
    --el-table-header-text-color: #94a3b8;
    --el-table-row-hover-bg-color: rgba(56, 189, 248, 0.08);
    color: #cbd5e1;

    &::before {
      background: rgba(255, 255, 255, 0.08);
    }
  }

  :deep(.el-switch.is-checked .el-switch__core) {
    background: #38bdf8;
    border-color: #38bdf8;
  }

  :deep(.el-dialog) {
    background: rgba(15, 23, 42, 0.97);
    border: 1px solid rgba(255, 255, 255, 0.1);
    .el-dialog__title {
      color: #f1f5f9;
    }
    .el-dialog__headerbtn .el-dialog__close {
      color: #94a3b8;
    }
  }
  :deep(.el-form-item__label) {
    color: #94a3b8;
  }
  :deep(.el-input__wrapper) {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: none;
    &:hover {
      border-color: rgba(56, 189, 248, 0.4);
    }
    &.is-focus {
      border-color: #38bdf8;
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
    }
  }
  :deep(.el-input__inner),
  :deep(.el-textarea__inner) {
    color: #e2e8f0;
    background: transparent;
    &::placeholder {
      color: #475569;
    }
  }
  :deep(.el-textarea__inner) {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: none;
  }
  :deep(.el-radio__label) {
    color: #cbd5e1;
  }
  :deep(.el-tag--success) {
    background: rgba(34, 197, 94, 0.15);
    border-color: rgba(34, 197, 94, 0.3);
    color: #86efac;
  }
  :deep(.el-tag--danger) {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.3);
    color: #fca5a5;
  }
  :deep(.el-tag--warning) {
    background: rgba(217, 119, 6, 0.15);
    border-color: rgba(217, 119, 6, 0.3);
    color: #fbbf24;
  }
  :deep(.el-tag--info) {
    background: rgba(148, 163, 184, 0.15);
    border-color: rgba(148, 163, 184, 0.3);
    color: #cbd5e1;
  }

  :deep(.el-pagination) {
    display: flex;
    color: #94a3b8;
    .el-pagination__total {
      color: #94a3b8;
    }
    button,
    .el-pager li {
      background: rgba(255, 255, 255, 0.06);
      color: #cbd5e1;
      &:hover {
        color: #38bdf8;
      }
      &.is-active {
        background: linear-gradient(135deg, #38bdf8, #818cf8);
        color: #fff;
      }
    }
  }
}
</style>
