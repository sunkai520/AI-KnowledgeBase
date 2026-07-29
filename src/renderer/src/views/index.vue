<template>
  <div class="homePage">
    <StartBack></StartBack>
    <div class="avatar">
      <img :src="userAvatar" class="avatarImg" />
      <div style="margin-top: 0.2rem; color: white" class="dw">
        <h3>{{ userNickname }}</h3>
      </div>
    </div>
    <div class="main">
      <!-- 内容区 -->
      <el-main class="content">
        <div class="cards">
          <el-card class="card glow" @click="goAiChat">
            <h2>🤖 AI 助手</h2>
            <p>支持流式对话、本地知识问答、适用于对话场景</p>
          </el-card>
          <el-card class="card glow" @click="goAiHuman">
            <h2>🎭 AI 超级员工</h2>
            <p>解放双手，指挥AI干活，适合复杂场景</p>
          </el-card>
          <el-card class="card glow" @click="goOnlineSearch">
            <h2>🌐 联网搜索</h2>
            <p>Google · Bing 联网搜索</p>
          </el-card>
          <el-card class="card glow" @click="goMediaManage">
            <h2>🎬 创作管理</h2>
            <p>AI 生成的图片 / 视频，统一查看、预览、复制、删除</p>
          </el-card>
          <el-card class="card glow" @click="goWriteStyle">
            <h2>📄 个人写作</h2>
            <p>持续追加样本，维护你的个人写作画像</p>
          </el-card>
          <el-card class="card glow" @click="goRag">
            <h2>🧠 知识库</h2>
            <p>向量检索 · 本地存储 · RAG</p>
          </el-card>
            <el-card class="card glow" @click="goToolbox">
            <h2>🧰 工具箱</h2>
            <p>定时任务 · 文件整理，日常自动化小工具</p>
          </el-card>
          <el-card class="card glow" @click="goSetting">
            <h2>⚙️ 模型配置</h2>
            <p>模型 · 配置</p>
          </el-card>
          <el-card class="card glow" @click="goSystemSetting">
            <h2>🛠️ 系统配置</h2>
            <p>个人中心 · 代理设置</p>
          </el-card>
        
        </div>
      </el-main>
    </div>
  </div>
</template>

<script setup>
import {
  HomeFilled,
  ChatDotRound,
  Document,
  Setting,
} from "@element-plus/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import router from "../router";
import StartBack from "@renderer/components/startBack.vue";
import { onMounted, ref } from "vue";
import {clearLocalDoc} from "@renderer/api/common";
import defaultAvatar from "@renderer/assets/img/default.png";

const userAvatar = ref(defaultAvatar);
const userNickname = ref("🙂AI助手🙂");

async function loadProfile() {
  try {
    const s = await window.electronAPI.getAllSettings();
    userAvatar.value = s.userAvatar || defaultAvatar;
    userNickname.value = s.userNickname || "🙂AI助手🙂";
  } catch {}
}
function goAiChat() {
  router.push("/home/chat");
}
function goRag() {
  router.push("/home/ragDocs");
}
function goSetting() {
  router.push("/home/modelSetting");
}
function goAiHuman() {
  router.push("/home/agent");
  // ElMessage.warning("功能尚未开发，敬请期待");
}
function goOnlineSearch() {
  router.push("/home/onlineSearch");
}
function goWriteStyle() {
  router.push("/home/writeStyle");
}
function goMediaManage() {
  router.push("/home/mediaManage");
}
function goSystemSetting() {
  router.push("/home/systemSetting");
}
function goToolbox() {
  router.push("/home/toolbox");
}
async function modelSetting() {
  let res = await window.electronAPI.getModelConfig();
  console.log(res, "rrrrr");
  if (!res.chat.provider) {
    await ElMessageBox.confirm(
      `为了不影响模型使用，请配置聊天模型的 API Key 和 Base URL`,
      "提示",
      { type: "warning", confirmButtonText: "去配置", cancelButtonText: "暂不配置" }
    );
    router.push({
      path: "/home/modelSetting",
      query: {
        optionId: "chat",
      },
    });
    return;
  }
  if (!res.embedding.provider) {
    await ElMessageBox.confirm(
      `为了不影响模型使用，请配置嵌入模型的 API Key 和 Base URL`,
      "提示",
      { type: "warning", confirmButtonText: "去配置", cancelButtonText: "暂不配置" }
    );
    router.push({
      path: "/home/modelSetting",
      query: {
        optionId: "embedding",
      },
    });

    return;
  }
}
onMounted(() => {
  modelSetting();
  clearLocalDoc({days:7})
  loadProfile();
});
</script>

<style scoped lang="scss">
.homePage {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #f8fafc, #eef2f7);
  padding: 20px;
  background: url("./assets/bg-ai-panel.svg") no-repeat center center / cover;
}
.dw {
  font-weight: bold;
  color: #fff;
  text-shadow: 0 0 5px #ff0000, 0 0 10px #ff9900, 0 0 15px #ffff00,
    0 0 20px #33cc33, 0 0 25px #3399ff, 0 0 30px #9933ff, 0 0 35px #ff33cc;
  animation: neon-rainbow 2s ease-in-out infinite alternate;
  letter-spacing: 5px;
}
@keyframes neon-rainbow {
  0% {
    text-shadow: 0 0 5px #ff0000, 0 0 10px #ff9900, 0 0 15px #ffff00,
      0 0 20px #33cc33, 0 0 25px #3399ff, 0 0 30px #9933ff, 0 0 35px #ff33cc;
  }
  100% {
    text-shadow: 0 0 10px #ff33cc, 0 0 15px #9933ff, 0 0 20px #3399ff,
      0 0 25px #33cc33, 0 0 30px #ffff00, 0 0 35px #ff9900, 0 0 40px #ff0000;
  }
}
.avatarImg {
  width: 120px;
  height: 120px;
  border-radius: 50%;
}
.avatar {
  text-align: center;
}
.main {
  flex: 1;
  display: flex;
}

.content {
  padding: 40px;
}

/* 卡片布局 */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 28px;
}

/* 卡片主体 */
.card {
  cursor: pointer;
  background: linear-gradient(180deg, #ffffff, #f9fafb);
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  color: #0f172a;
  padding: 30px;
  transition: all 0.35s ease;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

/* Hover 浮起 + 高级阴影 */
.card:hover {
  transform: translateY(-8px);
  box-shadow: 0 20px 40px #5de6ed, 0 0 0 1px #51e4ec;
}

/* 轻微高亮感 */
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

/* 标题 */
h2 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 10px;
}

/* 描述 */
p {
  font-size: 14px;
  color: #475569;
  line-height: 1.6;
}
</style>
