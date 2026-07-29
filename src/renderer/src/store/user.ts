import { defineStore } from 'pinia';
// import {useIpcRenderer} from "@vueuse/electron";
import { useDateFormat } from '@vueuse/core'
import JSEncrypt from 'jsencrypt';
import CryptoJS from 'crypto-js';
interface UserState {
    is_activation: boolean // 是否激活
    publicKey: string
    mark: string
    isSound: boolean
}

export const userModule = defineStore({
    id: 'user',
    state(): UserState {
        return {
            isSound: false,//是否语音播报
            mark: "anming",//标识key
            is_activation: false, //激活码是否激活
            // 只保留公钥用于验签，激活码由私钥在客户端之外的签发工具生成（见 activation-keys/issue-code.cjs）
            publicKey: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAloLehvWEZhFjdSj+DLU+
ZsBIGJWU/ZVx/Ku3yPcxdDotyix2Nb+f/M24S+RmMygjS2Q9kXOMXqvOXWGc5GPv
ZTuCOw8UfcphMXBzT22kKKgU0c26UEfyLpyaZs0TJM+zOYAzX2OsKJOb21Ann4Ac
EgkAsFyEdAUMheFGPypKbTFSZVHPDGPL4fz06buID4wRB0JHaoK6Y1e65yfbNNaH
v8Gi+a49DZBJ0tI08CDxTjxGyPoPRycShK+HnnXmKBzozTpcSZogUOO8Qr4oebIn
MWlfT1suZLPdT/GpF2WghRTqdhu3N4QH5365e1qnpnz5+wdtcVLCe19Mie4hSAiQ
4QIDAQAB
-----END PUBLIC KEY-----`,
        }
    },
    actions: {
        setSounds() {
            this.isSound = !this.isSound;
        },
        /**
         * @Description: 校验激活码是否正确
         */
        sendActivate(str: string = "") {
            const that = this;
            return new Promise(async (resolve) => {
                // 首先去查找激活文件是否存在 如果存在的话就使用激活文件中的激活码进行校验
                if (str) {
                    that.is_activation = false
                    return resolve(that.verifyRegistration(str))
                } else {
                    let res = await (window as any).electronAPI.getPriviteCode();
                    if (res) {
                        try {
                            const decode: string = atob(res)
                            that.is_activation = false
                            resolve(that.verifyRegistration(decode))
                        } catch (error) {
                            resolve(false)
                        }

                    } else {
                        resolve(false)
                    }
                }
            })
        },
        /**
         * @Description: 校验激活码是否匹配
         * 激活码格式：base64(JSON.stringify({ p: payloadJson, s: signature }))
         * p 由签发工具（activation-keys/issue-code.cjs，私钥只在该工具里）签名产生，
         * 这里只用公钥验签，公钥公开也无法伪造出合法签名
         */
        async verifyRegistration(str: string) {
            // 这里是获取用户的mac地址
            // const getMac = require('getmac')
            const mac = await (window as any).electronAPI.getmac();
            if (!mac) return false
            try {
                const envelope = JSON.parse(atob(str))
                const verifier = new JSEncrypt()
                verifier.setPublicKey(this.publicKey)
                const valid = verifier.verify(envelope.p, envelope.s, CryptoJS.SHA256)
                if (!valid) return false
                const tsData = JSON.parse(envelope.p)
                const YMD = useDateFormat(new Date(), 'YYYY-MM-DD')
                const currentDate = new Date(YMD.value)
                const endDate = new Date(tsData.date)
                if (mac.toUpperCase() === tsData.mac && tsData.mark === this.mark && currentDate < endDate) {
                    this.is_activation = true
                    return true
                }
                return false
            } catch (e) {
                return false
            }
        },
        /**
         * @Description: 激活成功后向主程序发送命令 生成激活文件
         */
        activationSuccessful(str: string) {
            const baseStr = encodeURI(str);
            (window as any).electronAPI.activeApp(btoa(baseStr))
            // const ipcRenderer = useIpcRenderer()
        }
    },
    getters: {},
});