<template>
  <div>
    <el-button @click="loginClick">登录</el-button>
  </div>
</template>

<script setup>
import router from "../../router";
const getAnswer = (params) => {
  let url = "http://localhost:5120/chat";
  return fetch(url, {
    method: "post",
    responseType: "stream",
    body: JSON.stringify(params),
    timeout: 60 * 1000,
    headers: {
      "content-type": "application/json",
    },
  });
};
function loginClick() {
  let accumulatedData = "";
  getAnswer({q:"你好"})
    .then(async (response) => {
      console.log("res", response);
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      function readWithTimeout() {
        reader.read().then(({ done, value }) => {
          if (done) {
            console.log("流结束");
            return;
          }
          console.log(new TextDecoder().decode(value)); // 输出数据
          let chunk = new TextDecoder().decode(value);
          if (chunk.trim() && !chunk.trim().endsWith("}")) {
            accumulatedData = chunk;
            // console.log(
            //   accumulatedData,
            //   "accumulatedDataaccumulatedDataaccumulatedData"
            // );
          } else {
            if (chunk.trim() && !chunk.trim().startsWith("data: ")) {
              chunk = accumulatedData + chunk.trim();
              // console.log(chunk, "=====");
              accumulatedData = "";
            }
            const lines = chunk.split("\n");
            for (const line of lines) {
              if (line.startsWith("data: ") && line.indexOf("DONE") == -1) {
                const data = JSON.parse(line.slice(6)); // 解析 JSON
                if (data.content) {
                  console.log(data.content,"content");
                }
              }
            }
          }

          setTimeout(readWithTimeout, 100); // 每100毫秒检查一次是否有新数据
        });
      }
      readWithTimeout();
    })
    .catch((err) => {
      console.log(err);
    });
  // router.push("/index");
}
</script>

<style lang="scss" scoped>
</style>