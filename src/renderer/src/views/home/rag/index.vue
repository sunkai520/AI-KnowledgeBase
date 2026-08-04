<template>
  <div class="article-container">
    <!-- 主内容区 -->
    <div class="content-wrapper">
      <!-- 头部区域 -->
      <header class="header-section">
        <el-button type="primary" class="add-btn neon-btn" @click="handleAdd">
          <el-icon class="btn-icon"><Plus /></el-icon>
          新增
        </el-button>
        <div class="title-wrapper">
          <el-select
            class="glow-select"
            style="width: 200px; margin-right: 10px"
            placeholder="请选择分类"
            filterable
            clearable
            v-model="sTypeId"
            @change="getTableList"
          >
            <el-option
              v-for="(k, index) in categoryList"
              :key="index"
              :label="k.labelType"
              :value="k.id"
            >
            </el-option>
          </el-select>
          <el-input
            class="glow-input"
            placeholder="请输入关键词进行搜索"
            style="width: 250px"
            :suffix-icon="Search"
            clearable
            v-model="keyWord"
            @input="inputChange"
          ></el-input>
          <el-icon class="refresh-icon" @click="getTableList"><Refresh></Refresh></el-icon>
        </div>
      </header>

      <!-- 文章列表 -->
      <div class="articles-grid" v-loading="tableLoading">
        <transition-group name="list" tag="div" class="grid-container">
          <div
            v-for="article in articles"
            :key="article.id"
            class="article-card glass-card"
          >
            <!-- 卡片发光边框效果 -->
            <div class="card-glow"></div>

            <!-- 卡片内容 -->
            <div class="card-content" @click="seeDetail(article)">
              <!-- 头部：仅保留标题，更宽敞 -->
              <div class="card-header">
                <h3 class="article-title" :title="article.title">
                  {{ article.title }}
                </h3>
              </div>

              <!-- 内容区域 -->
              <p class="article-desc">{{ stripHtml(article.content) || "暂无内容" }}</p>

              <!-- 底部区域：时间和操作按钮同行 -->
              <div class="card-footer">
                <div class="ffg">
                  <div class="article-meta">
                    <el-icon><Clock /></el-icon>
                    <span class="time-text">{{ article.createTime }}</span>
                  </div>
                  <div>
                    <el-tag type="danger" v-if="article.isRag == 2"
                      >未向量化</el-tag
                    >
                    <div v-else>
                      <el-tag type="success" v-if="article.status == 1"
                        >向量化成功</el-tag
                      >
                      <el-tag type="primary" v-else-if="article.status == 2"
                        >向量化中</el-tag
                      >
                      <el-tag type="danger" v-else>向量化失败</el-tag>
                    </div>
                  </div>
                </div>

                <!-- 操作按钮组 -->
                <div class="card-actions">
                  <el-button
                    type="primary"
                    plain
                    size="small"
                    class="action-btn edit-btn"
                    @click.stop="handleEdit(article)"
                  >
                    <el-icon><Edit /></el-icon>
                    <span>编辑</span>
                  </el-button>

                  <el-button
                    type="danger"
                    plain
                    size="small"
                    class="action-btn delete-btn"
                    @click.stop="handleDelete(article)"
                  >
                    <el-icon><Delete /></el-icon>
                    <span>删除</span>
                  </el-button>
                </div>
              </div>
            </div>

            <!-- 装饰性元素 -->
            <div class="card-decoration"></div>
          </div>
        </transition-group>
        <!-- 空状态 -->
        <div v-if="articles.length === 0" class="empty-state glass-card">
          <el-icon class="empty-icon"><Document /></el-icon>
          <p>暂无文章，点击上方按钮创建第一篇</p>
        </div>
      </div>
      <div class="pagination" v-if="articles.length > 0">
        <el-pagination
          background
          v-model:currentPage="pageConfig.page"
          v-model:page-size="pageConfig.pageSize"
          layout="prev, pager, next"
          :total="pageConfig.total"
          @size-change="handleSizeChange"
          @current-change="handleCurrentChange"
        />
      </div>
    </div>
    <!-- 编辑/新增对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEditing ? '编辑文章' : '新增文章'"
      width="40%"
      class="neon-dialog"
      destroy-on-close
      @close="ragReset"
    >
      <el-scrollbar height="400" style="padding-right: 20px">
        <el-form
          :model="form"
          label-position="top"
          class="article-form"
          :rules="formRules"
          ref="formRef"
        >
          <el-form-item label="文章标题" prop="title">
            <el-input
              v-model="form.title"
              placeholder="输入文章标题"
              size="large"
              class="glow-input"
              clearable
            />
          </el-form-item>
          <el-form-item label="文章分类" prop="typeId">
            <div style="display: flex; align-items: center; width: 100%">
              <el-select
                v-model="form.typeId"
                placeholder="请选择分类"
                size="large"
                class="glow-select"
                style="flex: 1"
                clearable
                filterable
              >
                <el-option
                  v-for="(k, index) in categoryList"
                  :key="index"
                  :label="k.labelType"
                  :value="k.id"
                >
                  <div class="option-content">
                    <span>{{ k.labelType }}</span>
                    <el-button
                      v-if="!k.isDefault"
                      type="danger"
                      link
                      size="small"
                      @click.stop="deleteCategory(k)"
                    >
                      <el-icon><Delete /></el-icon>
                    </el-button>
                  </div>
                </el-option>
              </el-select>
              <!-- 新增分类按钮 -->
              <el-button
                type="primary"
                link
                size="large"
                @click="showAddDialog = true"
                style="margin-left: 10px"
              >
                <el-icon><Plus /></el-icon>
                新增
              </el-button>
            </div>
          </el-form-item>
          <el-form-item label="同步模型" prop="isRag">
            <el-radio-group v-model="form.isRag">
              <el-radio :value="1">是</el-radio>
              <el-radio :value="2">否</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="方式" prop="isUpload">
            <el-radio-group v-model="form.isUpload" :disabled="isEditing">
              <el-radio :value="1">上传文件</el-radio>
              <el-radio :value="2">自定义内容</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="上传文件" v-if="form.isUpload == 1">
            <el-button
              type="primary"
              :icon="Plus"
              class="neon-upload-btn"
              :loading="uploadLoading"
              @click="uploadFiles"
            >
              <span>选择文件</span>
            </el-button>
            <span style="margin-left: 10px">仅支持上传1个文件（pdf/word/txt）</span>
          </el-form-item>
          <div
            class="fileList"
            v-if="form.isUpload == 1 && uploadFilesArray.length > 0"
          >
            <el-tag
              v-for="(k, index) in uploadFilesArray"
              :key="index"
              closable
              type="primary"
              style="margin-right: 5px; margin-bottom: 10px"
              @close="delFile(index)"
            >
              {{ k.fileName }}
            </el-tag>
          </div>
        </el-form>
      </el-scrollbar>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false" class="cancel-btn"
            >取消</el-button
          >
          <el-button
            type="primary"
            @click="handleSave"
            class="confirm-btn"
            :loading="saving"
            v-if="!isEditing"
          >
            {{ form.isUpload == 1 ? "保存" : "前往" }}
          </el-button>
          <el-button
            v-if="isEditing"
            type="primary"
            @click="handleSave(1)"
            class="confirm-btn"
            :loading="saving"
          >
            仅保存
          </el-button>
          <el-button
            type="primary"
            @click="handleSave"
            class="confirm-btn"
            :loading="saving"
            v-if="isEditing"
          >
            保存并前往
          </el-button>
        </div>
      </template>
    </el-dialog>
    <!-- 新增分类弹窗 -->
    <el-dialog
      v-model="showAddDialog"
      title="新增分类"
      width="35%"
      class="neon-dialog"
      @close="newCategoryName = ''"
    >
      <el-input
        v-model="newCategoryName"
        placeholder="请输入分类名称"
        class="glow-input"
      />
      <template #footer>
        <el-button @click="showAddDialog = false" class="cancel-btn"
          >取消</el-button
        >
        <el-button
          type="primary"
          @click="addCategory"
          class="confirm-btn"
          :loading="addTypeLoading"
          >确定</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import {
  Plus,
  Edit,
  Delete,
  Clock,
  Document,
  Search,
  Refresh
} from "@element-plus/icons-vue";
import { ElMention, ElMessage, ElMessageBox } from "element-plus";
import pageHooks from "@renderer/hooks/pageHooks";
import {
  add,
  del,
  list,
  saveText,
  textList,
  delText,
  updateText,
} from "@renderer/api/text";
import router from "../../../router";
import { debounce } from "../../../utils/common";
let { pageConfig, handleSizeChange, handleCurrentChange } = pageHooks(
  () => {
    getTableList();
  },
  { pageSize: 9 }
);
// 响应式数据
const articles = ref([]);

const dialogVisible = ref(false);
const isEditing = ref(false);
const saving = ref(false);
const currentId = ref(null);
const uploadLoading = ref(false);
const uploadFilesArray = ref([]);
const showAddDialog = ref(false);
const formRef = ref(null);
const tableLoading = ref(false);
const addTypeLoading = ref(false);
let keyWord = ref("");
let sTypeId = ref("");
const newCategoryName = ref("");
const categoryList = ref([]);

function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
const formRules = ref({
  title: [{ required: true, message: "请输入文章标题", trigger: "blur" }],
  typeId: [{ required: true, message: "请选择文章分类", trigger: "change" }],
});
const form = ref({
  title: "",
  typeId: "",
  isRag: 1,
  isUpload: 1,
});
// 删除分类
const deleteCategory = async (item) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除分类 "${item.labelType}" 吗？`,
      "提示",
      { type: "warning" }
    );
    let res = await del({ id: item.id });
    ElMessage.success("删除成功");
    geTypeList();
  } catch {
    // 取消删除
  }
};
function seeDetail(d) {
  router.push({
    path: "/home/writeText",
    query: {
      id: d.id,
      isRead: 1,
    },
  });
}
async function getTableList() {
  let params = {
    page: pageConfig.page,
    pageSize: pageConfig.pageSize,
    keyWord: keyWord.value,
    typeId: sTypeId.value,
  };
  tableLoading.value = true;
  let res = await textList(params)
    .finally(() => {})
    .finally(() => {
      tableLoading.value = false;
    });
  articles.value = res.data.list;
  pageConfig.total = res.data.total;
}
let inputChange = debounce(() => {
  pageConfig.page = 1;
  getTableList();
});
async function geTypeList() {
  let res = await list();
  console.log(res, "res");
  categoryList.value = res.data;
}
async function addCategory() {
  addTypeLoading.value = true;
  let res = await add({
    name: newCategoryName.value,
  }).finally(() => {
    addTypeLoading.value = false;
  });
  ElMessage.success("添加成功");
  showAddDialog.value = false;
  geTypeList();
}
function delFile(index) {
  uploadFilesArray.value.splice(index, 1);
}
const handleAdd = () => {
  isEditing.value = false;
  currentId.value = null;
  form.value = {
    title: "",
    typeId: "",
    isRag: 1,
    isUpload: 1,
  };
  dialogVisible.value = true;
};

const handleEdit = (article) => {
  isEditing.value = true;
  currentId.value = article.id;
  form.value = {
    title: article.title,
    content: article.content,
    typeId: article.typeId,
    isRag: article.isRag,
    isUpload: article.isUpload,
  };
  dialogVisible.value = true;
};

const handleSave = async (tp) => {
  await formRef.value.validate(async (valid, fields) => {
    if (valid) {
      console.log(isEditing.value, "===");
      if (isEditing.value) {
        saving.value = true;
        let res = await updateText({
          id: currentId.value,
          ...form.value,
        }).finally(() => {
          saving.value = false;
          dialogVisible.value = false;
        });
        if (tp == 1) {
          ElMessage.success("修改成功");
          getTableList();
          return;
        }
        router.push({
          path: "/home/writeText",
          query: {
            id: currentId.value,
          },
        });
      } else {
        if (form.value.isUpload == 1) {
          saving.value = true;
          let params = {
            ...form.value,
            filePaths: uploadFilesArray.value,
          };
          let res = await saveText(params).finally(() => {
            saving.value = false;
            dialogVisible.value = false;
          });
          ElMessage.success("保存成功");
          getTableList();
          console.log(params, "ssss");
        } else {
          let params = {
            ...form.value,
          };
          saving.value = true;
          let res = await saveText(params).finally(() => {
            saving.value = false;
            dialogVisible.value = false;
          });
          getTableList();
          router.push({
            path: "/home/writeText",
            query: {
              id: res.data.lastInsertRowid,
            },
          });
        }
      }
    } else {
      console.log("error submit!", fields);
    }
  });
};
function ragReset() {
  console.log("关闭");
  uploadFilesArray.value = [];
}
const handleDelete = async (article) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除文章《${article.title}》吗？`,
      "删除确认",
      {
        confirmButtonText: "确定删除",
        cancelButtonText: "取消",
        type: "warning",
        customClass: "neon-message-box",
      }
    );
    let res = await delText({ id: article.id });
    getTableList();
    ElMessage.success("删除成功");
  } catch {
    // 用户取消
  }
};
async function uploadFiles() {
  uploadLoading.value = true;
  let res = await window.electronAPI.selectFile().finally(() => {
    uploadLoading.value = false;
  });
  if (!res || res.length == 0) {
    return;
  }
  // 单篇上传：新选择的文件直接替换掉之前选择的文件
  uploadFilesArray.value = [res[0]];
  console.log(uploadFilesArray.value, ":rrrrr");
}
// 添加鼠标跟随发光效果
onMounted(() => {
  const cards = document.querySelectorAll(".article-card");
  cards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    });
  });
  geTypeList();
  getTableList();
});
</script>

<style scoped lang="scss">
/* 基础容器 */
.article-container {
  height: 100%;
  width: 100%;
  overflow: hidden;
  position: relative;
}
.pagination {
  margin-top: 10px;
  justify-content: center;
}
/* 内容包装器 */
.content-wrapper {
  height: 100%;
  width: 100%;
  position: relative;
  padding: 20px;
  display: flex;
  flex-direction: column;
}

/* 头部样式 */
.header-section {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.title-wrapper {
  display: flex;
  align-items: center;
}
.main-title {
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -1px;
  position: relative;
  line-height: 1.2;
}

.title-gradient {
  background: linear-gradient(135deg, #fff 0%, #a5b4fc 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.title-shine {
  position: absolute;
  left: 0;
  top: 0;
  background: linear-gradient(
    120deg,
    transparent 0%,
    rgba(255, 255, 255, 0.8) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shine 3s infinite linear;
  opacity: 0.3;
}

@keyframes shine {
  0% {
    background-position: 200% center;
  }
  100% {
    background-position: -200% center;
  }
}

.subtitle {
  color: #64748b;
  margin-top: 8px;
  font-size: 14px;
}



.btn-icon {
  margin-right: 6px;
}

/* 文章网格 */
.articles-grid {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 30px 10px;
  /* Webkit 浏览器：Chrome, Safari, Edge */
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE 10+ */
}

.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 24px;
}

/* 玻璃态卡片 */
.glass-card {
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
  border: 1px solid rgba(99, 148, 255, 0.3);
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  backdrop-filter: blur(10px);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.article-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;

  /* 顶部彩色光条 */
  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, #667eea, #a78bfa, #38bdf8);
    border-radius: 16px 16px 0 0;
    opacity: 0.8;
  }
}

.article-card:hover {
  transform: translateY(-6px);
  border-color: rgba(102, 126, 234, 0.6);
  box-shadow:
    0 24px 48px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(102, 126, 234, 0.3),
    0 0 40px rgba(102, 126, 234, 0.15);
}

/* 鼠标跟随光晕 */
.card-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: radial-gradient(
    500px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    rgba(102, 126, 234, 0.1),
    transparent 40%
  );
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.article-card:hover .card-glow {
  opacity: 1;
}

.card-content {
  padding: 22px 24px 20px;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  flex: 1;
}

:deep(.is-active) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}

.card-header {
  margin-bottom: 10px;
  width: 100%;
}

.article-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  color: #e8eaf6;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: 0.3px;
}

.article-desc {
  color: #7986a8;
  font-size: 13.5px;
  line-height: 1.65;
  margin: 0 0 16px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 14px;
  border-top: 1px solid rgba(102, 126, 234, 0.15);
  margin-top: auto;
  gap: 12px;

  .ffg {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
}

.refresh-icon {
  margin-left: 10px;
  cursor: pointer;
  font-size: 22px;
  color: #596576;
  transition: color 0.2s;

  &:hover {
    color: #a5b4fc;
  }
}

.article-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #4a5568;
  font-size: 12px;
  white-space: nowrap;
  flex-shrink: 0;
}

.time-text {
  color: #5a6a8a;
}

/* 操作按钮 */
.card-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  border-radius: 8px !important;
  font-weight: 500 !important;
  padding: 5px 12px !important;
  font-size: 12px !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 4px !important;
  transition: all 0.2s !important;
}

.edit-btn {
  background: rgba(102, 126, 234, 0.12) !important;
  border-color: rgba(102, 126, 234, 0.35) !important;
  color: #a5b4fc !important;
}

.edit-btn:hover {
  background: rgba(102, 126, 234, 0.25) !important;
  border-color: #667eea !important;
  color: #fff !important;
  box-shadow: 0 0 16px rgba(102, 126, 234, 0.35) !important;
}

.delete-btn {
  background: rgba(239, 68, 68, 0.08) !important;
  border-color: rgba(239, 68, 68, 0.25) !important;
  color: #fca5a5 !important;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.2) !important;
  border-color: #ef4444 !important;
  color: #fff !important;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.3) !important;
}

/* 右上角装饰光晕 */
.card-decoration {
  position: absolute;
  top: -30px;
  right: -30px;
  width: 120px;
  height: 120px;
  background: radial-gradient(circle, rgba(102, 126, 234, 0.15) 0%, transparent 70%);
  pointer-events: none;
  border-radius: 50%;
}

/* 空状态 */
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
  color: #475569;
}

/* 列表过渡动画 */
.list-enter-active,
.list-leave-active {
  transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
}

.list-enter-from {
  opacity: 0;
  transform: translateY(30px) scale(0.9);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(-30px);
}

.list-move {
  transition: transform 0.5s;
}



.article-form :deep(.el-form-item__label) {
  color: #94a3b8;
  font-weight: 600;
}

.glow-input :deep(.el-input__wrapper),
.glow-input :deep(.el-textarea__inner) {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
  color: #f1f5f9 !important;
  border-radius: 12px !important;
}

.glow-input :deep(.el-input__wrapper:hover),
.glow-input :deep(.el-textarea__inner:hover) {
  border-color: rgba(102, 126, 234, 0.5) !important;
}

.glow-input :deep(.el-input__wrapper.is-focus),
.glow-input :deep(.el-textarea__inner:focus) {
  border-color: #667eea !important;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1) !important;
}

/* 新增：分类选择器样式 */
.glow-select {
  width: 100%;
}

.glow-select :deep(.el-select__wrapper) {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
  color: #f1f5f9 !important;
  border-radius: 12px !important;
}

.glow-select :deep(.el-select__wrapper:hover) {
  border-color: rgba(102, 126, 234, 0.5) !important;
}

.glow-select :deep(.el-select__wrapper.is-focused) {
  border-color: #667eea !important;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1) !important;
}

.glow-select :deep(.el-select__placeholder) {
  color: #64748b !important;
}

.glow-select :deep(.el-select__selected-item) {
  color: #f1f5f9 !important;
}

/* 下拉菜单样式 */
:deep(.el-select-dropdown) {
  background: rgba(15, 23, 42, 0.95) !important;
  border: 1px solid rgba(102, 126, 234, 0.3) !important;
  border-radius: 12px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
}

:deep(.el-select-dropdown__item) {
  color: #94a3b8 !important;
}

:deep(.el-select-dropdown__item:hover),
:deep(.el-select-dropdown__item.hover) {
  background: rgba(102, 126, 234, 0.1) !important;
  color: #f1f5f9 !important;
}

:deep(.el-select-dropdown__item.selected) {
  background: rgba(102, 126, 234, 0.2) !important;
  color: #667eea !important;
  font-weight: 600;
}

/* 新增：上传按钮样式 */
.upload-wrapper {
  width: 100%;
}

.neon-upload-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  border: none !important;
  padding: 12px 24px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  color: #fff !important;
  border-radius: 12px !important;
  box-shadow: 0 0 20px rgba(102, 126, 234, 0.5) !important;
  transition: all 0.3s ease !important;
  position: relative;
  overflow: hidden;
}

.neon-upload-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 30px rgba(102, 126, 234, 0.7) !important;
}

.neon-upload-btn:active {
  transform: translateY(0);
}

.neon-upload-btn :deep(.el-icon) {
  margin-right: 6px;
  font-size: 16px;
}

/* 单选框样式优化 */
:deep(.el-radio__input.is-checked .el-radio__inner) {
  background: #667eea !important;
  border-color: #667eea !important;
}

:deep(.el-radio__input.is-checked + .el-radio__label) {
  color: #667eea !important;
}

:deep(.el-radio__label) {
  color: #94a3b8 !important;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 10px;
}

.cancel-btn {
  background: transparent !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: #94a3b8 !important;
}

.cancel-btn:hover {
  border-color: rgba(255, 255, 255, 0.4) !important;
  color: #f1f5f9 !important;
}

.confirm-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  border: none !important;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4) !important;
}

/* 消息框样式 */
:deep(.neon-message-box) {
  background: rgba(15, 23, 42, 0.95) !important;
  border: 1px solid rgba(239, 68, 68, 0.3) !important;
  border-radius: 16px !important;
}

:deep(.neon-message-box .el-message-box__title) {
  color: #f1f5f9;
}

:deep(.neon-message-box .el-message-box__message) {
  color: #94a3b8;
}

.option-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-right: 8px;
}

/* 悬停显示删除按钮 */
:deep(.el-select-dropdown__item) {
  padding-right: 0;
}

:deep(.el-select-dropdown__item .el-button) {
  opacity: 0;
  transition: opacity 0.2s;
}

:deep(.el-select-dropdown__item:hover .el-button) {
  opacity: 1;
}
</style>