<template>
  <div class="organizer-page">
    <div class="folder-picker">
      <el-button type="primary" @click="onSelectFolder">选择文件夹</el-button>
      <span class="folder-path">{{ folderPath || "尚未选择文件夹" }}</span>
    </div>

    <div class="options" v-if="folderPath">
      <el-checkbox v-model="recursive">包含子文件夹</el-checkbox>
      <el-checkbox v-model="useAI">AI 辅助归类未知文件</el-checkbox>
      <el-button @click="onPreview" :loading="previewing">预览</el-button>
    </div>

    <div class="plan-section" v-if="plan.length">
      <div class="plan-header">
        <span>共 {{ plan.length }} 个文件，已选 {{ selectedCount }} 个</span>
        <el-button type="primary" @click="onApply" :loading="applying">执行整理</el-button>
      </div>
      <el-collapse v-model="activeCategories">
        <el-collapse-item v-for="group in groupedPlan" :key="group.category" :name="group.category">
          <template #title>
            <span>{{ group.category }}（{{ group.items.length }} 个）</span>
          </template>
          <div v-for="item in group.items" :key="item.from" class="plan-item">
            <el-checkbox v-model="item.selected" />
            <span class="file-name">{{ baseName(item.from) }}</span>
            <span class="method-tag" v-if="item.method === 'ai'">AI 判断</span>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <div class="empty-tip" v-else-if="folderPath && !previewing">点击"预览"查看整理方案</div>

    <el-divider />

    <div class="history-section">
      <div class="history-header">
        <span>历史记录</span>
        <el-button size="small" @click="loadHistory">刷新</el-button>
      </div>
      <el-table :data="pagedHistory" size="small" v-loading="loadingHistory" max-height="300">
        <el-table-column prop="folderPath" label="文件夹" min-width="220" show-overflow-tooltip />
        <el-table-column prop="createdAt" label="时间" width="160" />
        <el-table-column label="移动文件数" width="100">
          <template #default="{ row }">{{ parseManifest(row).length }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button size="small" type="danger" @click="onUndo(row)">撤销</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="history.length"
        v-model:current-page="historyPage"
        :page-size="historyPageSize"
        :total="history.length"
        layout="total, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

const folderPath = ref("");
const recursive = ref(false);
const useAI = ref(true);
const plan = ref([]);
const previewing = ref(false);
const applying = ref(false);
const activeCategories = ref([]);
const history = ref([]);
const loadingHistory = ref(false);
const historyPage = ref(1);
const historyPageSize = ref(10);
const pagedHistory = computed(() => {
  const start = (historyPage.value - 1) * historyPageSize.value;
  return history.value.slice(start, start + historyPageSize.value);
});

const groupedPlan = computed(() => {
  const map = new Map();
  plan.value.forEach((item) => {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category).push(item);
  });
  return Array.from(map.entries()).map(([category, items]) => ({ category, items }));
});

const selectedCount = computed(() => plan.value.filter((p) => p.selected).length);

function baseName(p) {
  return p.split(/[\\/]/).pop();
}

function parseManifest(row) {
  try {
    return JSON.parse(row.manifestJson || "[]");
  } catch {
    return [];
  }
}

async function onSelectFolder() {
  const dir = await window.electronAPI.selectOrganizeFolder();
  if (dir) {
    folderPath.value = dir;
    plan.value = [];
    loadHistory();
  }
}

async function onPreview() {
  previewing.value = true;
  try {
    const result = await window.electronAPI.previewOrganize(folderPath.value, {
      recursive: recursive.value,
      useAI: useAI.value,
    });
    plan.value = result.map((item) => ({ ...item, selected: true }));
    activeCategories.value = Array.from(new Set(plan.value.map((p) => p.category)));
    if (!plan.value.length) ElMessage.info("这个文件夹里没有需要整理的文件");
  } catch (e) {
    ElMessage.error(e?.message || "预览失败");
  } finally {
    previewing.value = false;
  }
}

async function onApply() {
  // plan 是 ref 数组，元素会被 Vue 包成响应式 Proxy；Electron IPC 用结构化克隆传参，
  // Proxy 无法被克隆（报 "An object could not be cloned."），这里转成纯对象再传
  const selected = plan.value
    .filter((p) => p.selected)
    .map((p) => ({ from: p.from, to: p.to, category: p.category, method: p.method }));
  if (!selected.length) {
    ElMessage.warning("请至少选择一个文件");
    return;
  }
  applying.value = true;
  try {
    const result = await window.electronAPI.applyOrganize(folderPath.value, selected);
    ElMessage.success(`整理完成：成功 ${result.moved.length} 个，失败 ${result.errors.length} 个`);
    plan.value = [];
    loadHistory();
  } catch (e) {
    ElMessage.error(e?.message || "执行失败");
  } finally {
    applying.value = false;
  }
}

async function loadHistory() {
  loadingHistory.value = true;
  try {
    history.value = await window.electronAPI.organizeHistory(folderPath.value || undefined);
    const maxPage = Math.max(1, Math.ceil(history.value.length / historyPageSize.value));
    if (historyPage.value > maxPage) historyPage.value = maxPage;
  } finally {
    loadingHistory.value = false;
  }
}

async function onUndo(row) {
  await ElMessageBox.confirm("确定撤销这次整理操作吗？会把文件移回原位置。", "提示", { type: "warning" });
  const result = await window.electronAPI.undoOrganize(row.id);
  ElMessage.success(`已撤销：还原 ${result.restored.length} 个，失败 ${result.errors.length} 个`);
  loadHistory();
}

onMounted(() => {
  loadHistory();
});
</script>

<style scoped lang="scss">
.organizer-page {
  width: 100%;
}
.folder-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.folder-path {
  color: #64748b;
  font-size: 13px;
}
.options {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.plan-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.plan-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0;
}
.file-name {
  font-size: 13px;
}
.method-tag {
  font-size: 11px;
  color: #fff;
  background: #6366f1;
  padding: 1px 6px;
  border-radius: 4px;
}
.empty-tip {
  color: #94a3b8;
  padding: 20px 0;
  text-align: center;
}
.history-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

/* ── Element Plus 暗色覆盖：跟系统配置页保持一致的深色玻璃风格 ── */
.organizer-page {
  :deep(.el-button) {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
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

  :deep(.el-checkbox__label) {
    color: #cbd5e1;
  }

  :deep(.el-collapse) {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: none;
  }
  :deep(.el-collapse-item__header) {
    background: transparent;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    color: #e2e8f0;
  }
  :deep(.el-collapse-item__wrap) {
    background: transparent;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  :deep(.el-collapse-item__content) {
    color: #cbd5e1;
    padding-bottom: 8px;
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

  :deep(.el-divider) {
    border-color: rgba(255, 255, 255, 0.08);
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
