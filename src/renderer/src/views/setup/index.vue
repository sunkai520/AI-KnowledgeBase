<template>
  <div class="setup-page">
    <StartBack />
    <div class="setup-card">
      <div class="setup-icon">🗂️</div>
      <h2 class="setup-title">选择数据存储目录</h2>
      <p class="setup-desc">
        对话记录、知识库、模型配置将保存在此目录中。<br />
        重新安装应用后只需选择同一目录即可恢复所有数据。
      </p>

      <!-- 检测到上次目录 -->
      <div v-if="lastDir" class="last-dir-tip">
        <el-icon color="#38bdf8"><InfoFilled /></el-icon>
        <span>检测到上次数据目录：<strong>{{ lastDir }}</strong></span>
        <el-button size="small" type="primary" link @click="useLastDir">直接使用</el-button>
      </div>

      <!-- 当前选择 -->
      <div class="dir-selector">
        <el-input v-model="selectedDir" placeholder="请选择目录" readonly>
          <template #append>
            <el-button @click="pickDir">浏览...</el-button>
          </template>
        </el-input>
      </div>

      <div class="setup-actions">
        <el-button
          type="primary"
          size="large"
          :disabled="!selectedDir"
          :loading="saving"
          @click="confirm"
        >
          确认
        </el-button>
      </div>

      <p class="setup-hint">如果修改后有问题,请尝试重启应用</p>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { InfoFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import StartBack from '@renderer/components/startBack.vue';

const router = useRouter();

const lastDir = ref('');
const selectedDir = ref('');
const saving = ref(false);

onMounted(async () => {
  const status = await window.electronAPI.getDataPathStatus();
  if (status.dataDir) {
    lastDir.value = status.dataDir;
  }
});

async function pickDir() {
  const dir = await window.electronAPI.selectDataDir();
  if (dir) selectedDir.value = dir;
}

function useLastDir() {
  selectedDir.value = lastDir.value;
}

async function confirm() {
  if (!selectedDir.value) return;
  saving.value = true;
  try {
    const res = await window.electronAPI.setDataDir(selectedDir.value);
    if (!res?.success) {
      ElMessage.error(res?.error || '保存失败，请重试');
      saving.value = false;
      return;
    }
    ElMessage.success('设置成功！');
    router.replace('/index');
  } catch (e) {
    ElMessage.error(e?.message || '保存失败，请重试');
    saving.value = false;
  }
}
</script>

<style scoped lang="scss">
.setup-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.setup-card {
  position: relative;
  z-index: 1;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 20px;
  padding: 48px 56px;
  width: 560px;
  box-shadow: 0 20px 60px rgba(0, 231, 255, 0.2), 0 0 0 1px rgba(0, 231, 255, 0.15);
  text-align: center;
}

.setup-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.setup-title {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 10px;
}

.setup-desc {
  font-size: 14px;
  color: #64748b;
  line-height: 1.8;
  margin-bottom: 24px;
}

.last-dir-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 10px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #0369a1;
  text-align: left;
  flex-wrap: wrap;

  strong {
    word-break: break-all;
  }
}

.dir-selector {
  margin-bottom: 28px;
  text-align: left;
}

.setup-actions {
  margin-bottom: 12px;
}

.setup-hint {
  font-size: 12px;
  color: #94a3b8;
}
</style>
