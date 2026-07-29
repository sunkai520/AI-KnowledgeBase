<template>
  <div class="media-container">
    <div class="content-wrapper">
      <!-- 头部 -->
      <header class="header-section">
        <div class="title-wrapper">
          <h2 class="main-title">
            <span class="title-gradient">创作管理</span>
          </h2>
          <p class="sub-title">AI 生成的图片 / 视频，统一在这里查看、预览、复制、删除</p>
        </div>
        <div class="filter-wrapper">
          <el-radio-group v-model="filterType" @change="onFilterChange">
            <el-radio-button label="all">全部</el-radio-button>
            <el-radio-button label="image">图片</el-radio-button>
            <el-radio-button label="video">视频</el-radio-button>
          </el-radio-group>
          <el-icon class="refresh-icon" @click="loadList"><Refresh /></el-icon>
        </div>
      </header>

      <!-- 卡片网格 -->
      <div class="media-grid" v-loading="loading" element-loading-background="rgba(15, 23, 42, 0.55)">
        <div class="grid-container" v-if="items.length > 0">
          <div v-for="item in items" :key="item.type + item.filename" class="media-card glass-card">
            <div class="thumb-wrap">
              <img v-if="item.type === 'image'" :src="item.url" class="thumb" loading="lazy" @load="onMediaLoaded" />
              <div v-else class="video-placeholder" @click="openPreview(item)">
                <img v-if="item.poster" :src="item.poster" class="thumb" loading="lazy" @load="onMediaLoaded" />
                <el-icon class="play-icon"><VideoPlay /></el-icon>
              </div>
              <span class="type-badge">{{ item.type === "image" ? "🖼️ 图片" : "🎬 视频" }}</span>
              <div class="hover-actions">
                <el-button circle @click="openPreview(item)" title="预览">
                  <el-icon><View /></el-icon>
                </el-button>
                <el-button circle @click="copyItem(item)" title="复制">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
                <el-button circle type="danger" @click="removeItem(item)" title="删除">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
            <div class="card-footer">
              <span class="meta-time">{{ formatTime(item.createdAt) }}</span>
              <span class="meta-size">{{ formatSize(item.size) }}</span>
            </div>
          </div>
        </div>
        <div class="empty-state" v-else-if="!loading">
          <p>暂无生成的图片/视频，去 AI 超级员工里生成一些试试吧</p>
        </div>
      </div>

      <!-- 分页 -->
      <div class="pagination" v-if="total > pageSize">
        <el-pagination
          background
          v-model:currentPage="page"
          v-model:page-size="pageSize"
          layout="prev, pager, next"
          :total="total"
          @current-change="loadList"
        />
      </div>
    </div>

    <!-- 预览弹窗 -->
    <el-dialog v-model="previewVisible" width="60%" class="neon-dialog media-preview-dialog" destroy-on-close>
      <img v-if="previewItem?.type === 'image'" :src="previewItem.url" class="preview-media" />
      <video v-else-if="previewItem" :src="previewItem.url" class="preview-media" controls autoplay></video>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onActivated } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { View, CopyDocument, Delete, Refresh, VideoPlay } from "@element-plus/icons-vue";
import { listGeneratedMedia, deleteGeneratedMedia, copyGeneratedImage } from "@renderer/api/index";

defineOptions({ name: "MediaManage" });

const items = ref([]);
const loading = ref(false);
const filterType = ref("all");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const previewVisible = ref(false);
const previewItem = ref(null);

async function loadList() {
  loading.value = true;
  try {
    const res = await listGeneratedMedia({ type: filterType.value, page: page.value, pageSize: pageSize.value });
    items.value = res.data.items;
    total.value = res.data.total;
  } catch (e) {
    ElMessage.error(`获取列表失败：${e?.message || e}`);
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.value = 1;
  loadList();
}

function onMediaLoaded(e) {
  e.target.classList.add("is-loaded");
}

function openPreview(item) {
  previewItem.value = item;
  previewVisible.value = true;
}

async function copyItem(item) {
  try {
    if (item.type === "image") {
      await copyGeneratedImage(item.filename);
      ElMessage.success("已复制到剪贴板，可直接粘贴到其他应用");
    } else {
      await navigator.clipboard.writeText(item.url);
      ElMessage.success("视频链接已复制");
    }
  } catch (e) {
    ElMessage.error(`复制失败：${e?.message || e}`);
  }
}

async function removeItem(item) {
  try {
    await ElMessageBox.confirm("确定删除这个文件吗？删除后不可恢复", "提示", {
      type: "warning",
      confirmButtonText: "删除",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    await deleteGeneratedMedia(item.type, item.filename);
    ElMessage.success("已删除");
    if (items.value.length === 1 && page.value > 1) page.value -= 1;
    loadList();
  } catch (e) {
    ElMessage.error(`删除失败：${e?.message || e}`);
  }
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 用 onActivated 而不是 onMounted：页面被 keep-alive 缓存后，
// 每次切回来都能刷新列表，同时不会因为 keep-alive 缓存而完全不刷新
onActivated(() => {
  loadList();
});
</script>

<style scoped lang="scss">
.media-container {
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
}

.content-wrapper {
  height: 100%;
  width: 100%;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

.header-section {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: 10px;
  gap: 12px;
}

.main-title {
  margin: 0;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -1px;
}

.title-gradient {
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.sub-title {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgba(226, 232, 240, 0.6);
}

.filter-wrapper {
  display: flex;
  align-items: center;
  gap: 12px;
}

.refresh-icon {
  cursor: pointer;
  color: rgba(226, 232, 240, 0.7);
  font-size: 18px;
  &:hover {
    color: #a5b4fc;
  }
}

.media-grid {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 10px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 22px;
}

.glass-card {
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
  border: 1px solid rgba(99, 148, 255, 0.3);
  border-radius: 14px;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.media-card:hover {
  transform: translateY(-4px);
  border-color: rgba(102, 126, 234, 0.6);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(102, 126, 234, 0.3);
}

.thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
}

.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  opacity: 0;
  transition: opacity 0.25s ease;
  &.is-loaded {
    opacity: 1;
  }
}

.video-placeholder {
  position: relative;
  width: 100%;
  height: 100%;
  cursor: pointer;

  .play-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 40px;
    color: rgba(226, 232, 240, 0.75);
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
    transition: color 0.2s, transform 0.2s;
  }

  &:hover .play-icon {
    color: #a5b4fc;
    transform: translate(-50%, -50%) scale(1.15);
  }
}

.type-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.7);
  color: #e2e8f0;
  backdrop-filter: blur(4px);
}

.hover-actions {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: rgba(15, 23, 42, 0.55);
  opacity: 0;
  transition: opacity 0.25s;
}

.thumb-wrap:hover .hover-actions {
  opacity: 1;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  font-size: 12px;
  color: rgba(226, 232, 240, 0.6);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: rgba(226, 232, 240, 0.5);
  font-size: 14px;
}

.pagination {
  margin-top: 10px;
  display: flex;
  justify-content: center;
}

.preview-media {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
}
</style>
