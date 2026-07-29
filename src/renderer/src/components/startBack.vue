<template>
  <div class="ai-gaming-bg" :class="{ paused: !visible }">
    <!-- 光带层 -->
    <div class="light-band light-band-1"></div>
    <div class="light-band light-band-2"></div>
    <div class="light-band light-band-3"></div>

    <!-- 粒子层 -->
    <div
      v-for="i in PARTICLE_COUNT"
      :key="i"
      class="particle"
      :style="getParticleStyle(i)"
    ></div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";

// 粒子数量从 50 降到 18：DOM 节点越多，逐帧合成开销越大
const PARTICLE_COUNT = 18;

// 生成粒子样式（随机位置/大小/动画）
const getParticleStyle = (i) => {
  const size = Math.random() * 4 + 1; // 1~5px
  const left = Math.random() * 100;
  const top = Math.random() * 100;
  const duration = Math.random() * 15 + 10; // 10~25s
  const delay = Math.random() * 5;
  const opacity = Math.random() * 0.4 + 0.1;

  return {
    width: `${size}px`,
    height: `${size}px`,
    left: `${left}%`,
    top: `${top}%`,
    animationDuration: `${duration}s`,
    animationDelay: `${delay}s`,
    opacity,
  };
};

// 窗口最小化/切到后台时 document.hidden 为 true，暂停所有动画，避免空耗 CPU
const visible = ref(true);
const handleVisibilityChange = () => {
  visible.value = !document.hidden;
};
onMounted(() => {
  document.addEventListener("visibilitychange", handleVisibilityChange);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});
</script>

<style lang="scss" scoped>
// === 全局变量（科技感主色）===
$color-primary: #00f3ff; // 荧光青蓝（光带主色）
$color-accent: #ff6b6b; // 活力橙红（头像/点缀）
$color-dark: #0a0f25; // 深空蓝底
$color-mid: #1a2342; // 中层蓝

.ai-gaming-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: $color-dark !important;
  z-index: -1;

  // 光带通用样式
  // 注意：不要用 filter: blur() 做柔光——每帧都要重新采样模糊区域，
  // 3 条大尺寸光带叠加转动时会持续吃满合成线程。改用渐变本身做柔化，
  // 视觉效果接近，但只是普通的 transform 动画，开销低得多。
  .light-band {
    position: absolute;
    border-radius: 50%;
    opacity: 0.6;
    background: radial-gradient(
      circle,
      rgba($color-primary, 0.9) 0%,
      rgba($color-primary, 0.35) 45%,
      transparent 75%
    );
    transform: translate(-50%, -50%);
  }

  .light-band-1 {
    width: 800px;
    height: 200px;
    top: 30%;
    left: 20%;
    animation: flow 25s linear infinite;
  }
  .light-band-2 {
    width: 1200px;
    height: 300px;
    top: 60%;
    left: 70%;
    opacity: 0.4;
    animation: flow 35s linear infinite reverse;
  }
  .light-band-3 {
    width: 600px;
    height: 150px;
    top: 50%;
    left: 50%;
    opacity: 0.3;
    animation: flow 20s linear infinite;
  }

  // 粒子
  .particle {
    position: absolute;
    background: $color-primary;
    border-radius: 50%;
    box-shadow: 0 0 10px $color-primary;
    animation: float 15s ease-in-out infinite;
  }

  // 窗口最小化/切到后台时暂停全部动画，避免不可见时空耗 CPU
  &.paused {
    .light-band,
    .particle {
      animation-play-state: paused;
    }
  }
}
// === 动画定义 ===
@keyframes flow {
  0% {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  100% {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes float {
  0%,
  100% {
    transform: translate(0, 0) rotate(0deg);
    opacity: 0.3;
  }
  50% {
    transform: translate(calc(var(--dx, 0) * 1px), calc(var(--dy, 0) * 1px))
      rotate(180deg);
    opacity: 0.8;
  }
}

// 为粒子注入随机位移变量（通过 :style 动态生成）
:deep(.particle) {
  --dx: v-bind("Math.random() * 100 - 50");
  --dy: v-bind("Math.random() * 100 - 50");
}
</style>