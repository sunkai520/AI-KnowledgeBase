<template>
  <div class="writeStyle">
    <el-container class="container">
      <el-header style="line-height: 60px" class="header">
        <div class="header-left">
          <el-button
            type="primary"
            class="add-btn neon-btn"
            @click="showAdd = true"
          >
            <el-icon class="btn-icon"><Plus /></el-icon>
            新增
          </el-button>
        </div>

        <div class="header-right">
          <!-- <el-input v-model="keyWord" placeholder="请输入关键词查询" clearable>
            <template #append>
              <el-button
                type="primary"
                style="color: white"
                :icon="Search"
                @click="searchBtn"
              ></el-button>
            </template>
          </el-input> -->
          <el-input
            placeholder="请输入关键词进行搜索"
            style="width: 250px"
            :suffix-icon="Search"
            clearable
            v-model="keyWord"
            @input="inputChange"
          ></el-input>
        </div>
      </el-header>
      <el-divider></el-divider>
      <el-main class="elmain">
        <!-- 卡片滚动区 -->
        <div class="articles-scroll" v-loading="tableLoading">
          <div class="grid-container" v-if="articles.length > 0">
            <div
              v-for="(item, idx) in articles"
              :key="idx"
              class="article-card glass-card"
              @mousemove="onMouseMove($event, idx)"
            >
              <div class="card-glow" :ref="el => glowRefs[idx] = el"></div>
              <div class="card-content">
                <!-- 标题行 -->
                <div class="card-header">
                  <h3 class="article-title" :title="item.title">{{ item.title }}</h3>
                  <el-dropdown>
                    <el-icon class="emenu"><Menu /></el-icon>
                    <template #dropdown>
                      <el-dropdown-menu>
                        <el-dropdown-item>
                          <el-button type="danger" size="small" text @click="remove(item.id)">删除</el-button>
                        </el-dropdown-item>
                        <el-dropdown-item>
                          <el-button size="small" text @click="aiWrite(item)">AI写作</el-button>
                        </el-dropdown-item>
                      </el-dropdown-menu>
                    </template>
                  </el-dropdown>
                </div>
                <div class="createTime">{{ item.createTime }}</div>

                <!-- 内容 -->
                <div class="card-body">
                  <div class="field-row">
                    <span class="label">简介</span>
                    <span class="desc">{{ item.content }}</span>
                  </div>
                  <div class="field-row">
                    <span class="label">画像</span>
                    <span class="desc">{{ item.styleProfile?.summary || item.content }}</span>
                  </div>
                </div>
              </div>
              <div class="card-decoration"></div>
            </div>
          </div>
          <!-- 空状态 -->
          <div class="empty-wrap" v-if="!articles.length">
            <el-empty description="暂无文章，点击左上角新增" />
          </div>
        </div>

        <!-- 分页：固定在底部 -->
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
      </el-main>
    </el-container>

    <!-- 新增弹窗 -->
    <el-dialog
      v-model="showAdd"
      title="新增"
      width="60%"
      @closed="reset"
      v-if="showAdd"
      class="neon-dialog"
    >
      <el-form :model="form" label-position="top">
        <el-form-item label="方式">
          <el-radio-group v-model="form.type">
            <el-radio value="1">上传</el-radio>
            <el-radio value="2">自定义内容</el-radio>
            <el-radio value="3">网站</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item
          label="内容"
          v-if="form.type == 2"
          :rules="[
            {
              required: true,
              message: '内容不能为空',
              trigger: 'blur',
            },
          ]"
        >
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="4"
            placeholder="请输入内容"
          />
        </el-form-item>
        <el-form-item label="上传文章" v-else-if="form.type == 1">
          <div>
            <div>
              <el-tooltip effect="dark" placement="bottom">
                <template #content>
                  <!-- <p>文档数量：1个</p> -->
                  <p>文件类型：pdf、txt、docx、doc、pptx</p>
                  <!-- <p>大小不超过10M</p> -->
                </template>
                <el-button
                  type="primary"
                  :icon="Plus"
                  @click="uploadFiles"
                  :loading="uploadLoading"
                  >上传</el-button
                >
              </el-tooltip>
            </div>
            <div v-if="form.filePaths.length > 0">
              {{
                form.filePaths
                  .map((f) => {
                    return f.fileName;
                  })
                  .join(";")
              }}
            </div>
          </div>
        </el-form-item>
        <el-form-item
          v-else
          label="网站"
          :rules="[
            {
              required: true,
              message: '网站不能为空',
              trigger: 'blur',
            },
          ]"
        >
          <el-input placeholder="请输入网站地址" v-model="form.url"></el-input>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="confirm" :loading="addLoading"
          >确定</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
    
    <script setup>
import { ref, reactive, onMounted } from "vue";
import { Delete, Plus, Search, Menu } from "@element-plus/icons-vue";
import pageHooks from "@renderer/hooks/pageHooks";
import { add, list, del } from "@renderer/api/writeStyle";
import { ElMessage, ElMessageBox } from "element-plus";
import router from "../../../router";
import { debounce } from "../../../utils/common";
/* ---------- 数据 ---------- */
const articles = ref([]);
let { pageConfig, handleSizeChange, handleCurrentChange } = pageHooks(
  () => {
    getList();
  },
  { pageSize: 10 }
);
const addLoading = ref(false);
const uploadLoading = ref(false);
const keyWord = ref("");
const showAdd = ref(false);
const tableLoading = ref(false);
let inputChange = debounce(() => {
  pageConfig.page = 1;
  getList();
});
const form = reactive({
  content: "",
  type: "1",
  url: "",
  filePaths: [],
});
async function uploadFiles() {
  uploadLoading.value = true;
  let res = await window.electronAPI.selectFile();
  uploadLoading.value = false;
  if (!res || res.length == 0) {
    return;
  }
  form.filePaths = res;
}
/* ---------- 方法 ---------- */
function reset() {
  form.content = "";
  form.type = "1";
  form.url = "";
  form.filePaths = [];
}

async function confirm() {
  addLoading.value = true;
  let d = await add({
    ...form,
  }).finally(() => {
    addLoading.value = false;
  });
  ElMessage.success("生成成功");
  getList();
  showAdd.value = false;
}
function aiWrite(item) {
  console.log(item);
  router.push({
    path: "/home/chat",
    query: {
      id: item.id,
    },
  });
}
function remove(id) {
  ElMessageBox.confirm("确定删除吗?", "提示", {
    confirmButtonText: "确定",
    cancelButtonText: "取消",
    type: "warning",
  }).then(async () => {
    let res = await del({ id: id });
    ElMessage.success("删除成功");
    getList();
  });
  // articles.value = articles.value.filter((item) => item.id !== id);
}
function searchBtn() {
  pageConfig.page = 1;
  getList();
}
async function getList() {
  tableLoading.value = true;
  let res = await list({
    page: pageConfig.page,
    pageSize: 10,
    keyWord: keyWord.value,
  }).finally(() => {
    tableLoading.value = false;
  });
  articles.value = res.data.list;
  pageConfig.total = res.data.total;
}
const glowRefs = ref([]);
function onMouseMove(e, idx) {
  const card = e.currentTarget;
  const rect = card.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  card.style.setProperty("--mouse-x", `${x}px`);
  card.style.setProperty("--mouse-y", `${y}px`);
}

onMounted(() => {
  getList();
});
</script>
    
<style lang="scss" scoped>
/* ===== 整体高度链 ===== */
.writeStyle {
  height: 100%;
  overflow: hidden;
  width: 100%;
  display: flex;
  flex-direction: column;
}

.container {
  height: 100%;
  width: 100%;
  display: flex;
  flex-direction: column;
}

/* 头部 */
:deep(.el-header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  padding: 0 20px;
}

:deep(.el-divider) {
  margin: 0;
  flex-shrink: 0;
}

/* 主区域：占剩余高度，内部两段式 */
.elmain {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 20px 24px 0;
  min-height: 0;
}

/* 卡片滚动区 */
.articles-scroll {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px 2px 16px;
  min-height: 0;

  &::-webkit-scrollbar {
    display: none;
  }
}

/* 空状态居中 */
.empty-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

/* 分页固定在底部 */
.pagination {
  flex-shrink: 0;
  padding: 14px 0 16px;
  display: flex;
  justify-content: center;
  border-top: 1px solid rgba(99, 148, 255, 0.1);
}

/* ===== 网格 ===== */
.grid-container {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
  align-items: start;
}

/* ===== 卡片 ===== */
.glass-card {
  background: linear-gradient(145deg, #1e2d4a 0%, #162238 100%);
  border: 1px solid rgba(99, 148, 255, 0.25);
  border-radius: 14px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.article-card {
  cursor: pointer;
  display: flex;
  flex-direction: column;

  &::before {
    content: "";
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, #667eea, #a78bfa, #38bdf8);
    border-radius: 14px 14px 0 0;
    opacity: 0.85;
  }

  &:hover {
    transform: translateY(-5px);
    border-color: rgba(102, 126, 234, 0.5);
    box-shadow:
      0 16px 40px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(102, 126, 234, 0.25),
      0 0 24px rgba(102, 126, 234, 0.1);

    .card-glow { opacity: 1; }
  }
}

.card-glow {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    400px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    rgba(102, 126, 234, 0.1),
    transparent 40%
  );
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}

.card-content {
  padding: 18px 20px 20px;
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.article-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: #e2e8f0;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  padding-right: 10px;
}

.emenu {
  cursor: pointer;
  color: #94a3b8;
  font-size: 16px;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid rgba(99, 148, 255, 0.2);
  background: rgba(255, 255, 255, 0.04);
  transition: all 0.2s;

  &:hover {
    color: #c4b5fd;
    background: rgba(102, 126, 234, 0.18);
    border-color: rgba(102, 126, 234, 0.45);
    box-shadow: 0 0 10px rgba(102, 126, 234, 0.2);
  }
}

.createTime {
  font-size: 12px;
  color: #6b7fa0;
  margin-bottom: 14px;
}

/* 字段行 */
.card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 11px;
  color: #667eea;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 5px;

  &::before {
    content: "";
    display: inline-block;
    width: 2px;
    height: 10px;
    background: linear-gradient(180deg, #667eea, #a78bfa);
    border-radius: 1px;
  }
}

.desc {
  font-size: 13px;
  color: #7a8eae;
  line-height: 1.65;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-decoration {
  position: absolute;
  top: -20px;
  right: -20px;
  width: 100px;
  height: 100px;
  background: radial-gradient(circle, rgba(102, 126, 234, 0.1) 0%, transparent 70%);
  pointer-events: none;
  border-radius: 50%;
}

/* ===== 霓虹按钮 ===== */
.neon-btn {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  border: none !important;
  padding: 10px 20px !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  box-shadow: 0 0 16px rgba(102, 126, 234, 0.45) !important;
  transition: all 0.25s ease !important;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 24px rgba(102, 126, 234, 0.65) !important;
  }

  &:active { transform: translateY(0); }
}

:deep(.is-active) {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
}

/* ===== 搜索框样式 ===== */
:deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  box-shadow: none !important;
  border-radius: 10px !important;
  color: #f1f5f9 !important;

  &:hover { border-color: rgba(102, 126, 234, 0.45) !important; }
  &.is-focus { border-color: #667eea !important; }
}

:deep(.el-input__inner) {
  color: #f1f5f9 !important;
  &::placeholder { color: #4a5a7a; }
}

:deep(.el-input__suffix-inner .el-icon) {
  color: #4a5a7a;
}
</style>
