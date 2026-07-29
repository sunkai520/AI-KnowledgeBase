<template>
  <div class="content">
    <StartBack></StartBack>
    <div>
      <span @click="back" class="back">
        <el-icon><Back /></el-icon>
        <span>返回</span>
      </span>
      <!-- <el-icon><Back /></el-icon>
        <span >返回</span> -->
    </div>
    <router-view v-slot="{ Component }">
      <!-- {{cacheList}} -->
      <keep-alive :include="cacheList">
        <component :is="Component" />
      </keep-alive>
    </router-view>
  </div>
</template>

<script setup>
import { ref } from "vue";
import { Back } from "@element-plus/icons-vue";
import router from "../../router";
import StartBack from "@renderer/components/startBack.vue"
// 缓存这两个页面，避免每次打开都整棵组件树销毁重建（视频重新解码/数据重新拉取会造成短暂黑屏）
let cacheList = ref(["MediaManage", "AgentIndex"]);
let back = () => {
  if (router.currentRoute.value.name === "onlineSearch") {
    const handled = !window.dispatchEvent(
      new CustomEvent("online-search:outer-back", { cancelable: true }),
    );
    if (handled) return;
  }
  router.go(-1);
};
</script>

<style scoped lang="scss">
.content {
  padding: 10px;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  // background: linear-gradient(180deg, #f8fafc, #eef2f7);
  .back {
    width: 60px;
    display: flex;
    align-items: center;
    margin-bottom: 10px;
    color: white;
    cursor: pointer;
    span {
      margin-left: 3px;
      color: white;
    }
  }
}
</style>
