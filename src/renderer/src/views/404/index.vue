<template>
  <div v-loading="isLoading">
    <div style="width: 100%; height: 100%">
      <div
        style="
          width: 100%;
          height: calc(100vh);
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          background: #3b3b3b;
          color: white !important;
        "
      >
        <div>
          mac:{{ mac.toUpperCase()
          }}<span class="copy" @click="copyMac">复制</span>
        </div>
        <p
          style="
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          "
          class="desc"
        >
          抱歉，您沒有使用权限!
          <el-button type="primary" link @click="openDialog">去激活</el-button>
        </p>
        <!-- <pre v-html="text" style="color: #009169"></pre>
        <p
          style="
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          "
          class="descFoot"
        >
          Sorry, you do not have permission to use it!
          <el-button type="primary" link @click="openDialog"
            >Go Activation</el-button
          >
        </p> -->
      </div>
      <!-- <el-footer class="ts-layout--footer" style="padding: 0!important;">
                <span>@2023 Author (Anming)</span>
            </el-footer> -->
    </div>

    <el-dialog v-model="activationVisible">
      <el-input
        v-model="activationCode"
        :rows="10"
        type="textarea"
        placeholder="请输入激活码"
        @focus="activationCodeFocus"
      />
      <div
        v-if="message.length > 1"
        style="text-align: center; margin-top: 10px"
        :style="{ color: pass ? '#67c23a' : '#f56c6c' }"
      >
        {{ message }}
      </div>
      <div
        v-if="message.length === 0"
        style="
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-top: 10px;
        "
      >
        <el-button
          type="primary"
          @click="activation"
          style="width: 120px"
          v-if="activationCode"
          >激活</el-button
        >
      </div>
    </el-dialog>
  </div>
</template>
  
 <script lang="ts">
import { defineComponent, onMounted, reactive, ref, toRefs } from "vue";
import { userModule } from "@renderer/store/user";
import router from "../../router";
import { copyText } from "../../utils/common";
//  import router from "@/router";

export default defineComponent({
  setup() {
    let user = userModule();
    const text = ref<string>(
      "@@@@@@@   @@@  @@@   @@@@@@   @@@@@@@@  @@@  @@@  @@@  @@@  @@@ \n" +
        "@@@@@@@@  @@@  @@@  @@@@@@@@  @@@@@@@@  @@@@ @@@  @@@  @@@  @@@ \n" +
        "@@!  @@@  @@!  @@@  @@!  @@@  @@!       @@!@!@@@  @@!  @@!  !@@ \n" +
        "!@!  @!@  !@!  @!@  !@!  @!@  !@!       !@!!@!@!  !@!  !@!  @!! \n" +
        "@!@@!@!   @!@!@!@!  @!@  !@!  @!!!:!    @!@ !!@!  !!@   !@@!@!  \n" +
        "!!@!!!    !!!@!!!!  !@!  !!!  !!!!!:    !@!  !!!  !!!    @!!!   \n" +
        "!!:       !!:  !!!  !!:  !!!  !!:       !!:  !!!  !!:   !: :!!  \n" +
        ":!:       :!:  !:!  :!:  !:!  :!:       :!:  !:!  :!:  :!:  !:! \n" +
        " ::       ::   :::  ::::: ::   :: ::::   ::   ::   ::   ::  ::: \n" +
        " :         :   : :   : :  :   : :: ::   ::    :   :     :   ::  \n" +
        "                                                                \n" +
        "                            .-==========                        \n" +
        "                         .-' O    =====                         \n" +
        "                        /___       ===                          \n" +
        "                           \\_      |                            \n" +
        "_____________________________)    (_____________________________\n" +
        "\\___________               .'      `,              ____________/\n" +
        "  \\__________`.     |||<   `.      .'   >|||     .'__________/  \n" +
        "     \\_________`._  |||  <   `-..-'   >  |||  _.'_________/     \n" +
        "        \\_________`-..|_  _ <      > _  _|..-'_________/        \n" +
        "           \\_________   |_|  //  \\\\  |_|   _________/           \n" +
        "                      .-\\   //    \\\\   /-.                      \n" +
        "      ,  .         _.'.- `._        _.' -.`._         .  ,      \n" +
        "    <<<<>>>>     .' .'  /  '``----''`  \\  `. `.     <<<<>>>>    \n" +
        "      '/\\`         /  .' .'.'/|..|\\`.`. `.  \\         '/\\`      \n" +
        "      (())        `  /  / .'| |||| |`. \\  \\  '        (())      \n" +
        "       /\\          ::_.' .' /| || |\\ `. `._::          /\\       \n" +
        "      //\\\\           '``.' | | || | | `.''`           //\\\\      \n" +
        "      //\\\\             .` .` | || | '. '.             //\\\\      \n" +
        "      //\\\\                `  | `' |  '                //\\\\      \n" +
        "      \\\\//                                            \\\\//      \n" +
        "       \\/                    Etc.End                   \\/       "
    );

    const activationVisible = ref<boolean>(false);
    const state = reactive({
      activationCode: "",
      message: "",
      pass: false,
      isLoading: false,
      mac: "",
    });
    onMounted(async () => {
      const mac = await (window as any).electronAPI.getmac();
      state.mac = mac;
    });
    const activation = () => {
      state.message = "";
      user.sendActivate(state.activationCode).then((ts) => {
        if (ts) {
          state.message = "激活成功!";
          state.pass = true;
          state.isLoading = true;
          setTimeout(() => {
            state.isLoading = false;
            activationVisible.value = false;
            // 激活成功后向主程序发送命令 生成激活文件
            user.activationSuccessful(state.activationCode);
            router.push({
              path: "/index",
            });
          }, 2 * 1000);
        } else {
          state.pass = false;
          state.message = "无效激活码!";
        }
      });
    };
    const activationCodeFocus = () => {
      state.pass = false;
      state.message = "";
    };
    const openDialog = () => {
      activationVisible.value = true;
      state.message = "";
    };
    const copyMac = () => {
      copyText(state.mac.toUpperCase());
    };
    return {
      copyMac,
      ...toRefs(state),
      activation,
      activationCodeFocus,
      text,
      openDialog,
      activationVisible,
    };
  },
});
</script>

 <style scoped lang="scss">
.desc {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 20px;
}
.descFoot {
  margin-top: 20px;
  font-weight: 600;
}
.copy {
  cursor: pointer;
  margin-left: 10px;
  color: rgb(64, 158, 255);
}
</style>