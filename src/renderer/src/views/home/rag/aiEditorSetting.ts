
import { uploadImage,uploadAttachment,uploadVideo } from "@renderer/api/index";
export let imageSetting = {
    allowBase64: false,
    uploadUrl: "http://127.0.0.1:5120/upload/images",
    //@ts-ignore
    uploader: async (file, uploadUrl, headers, formName) => {
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response: any = await uploadImage(formData);
            console.log(response, "rrrr")
            // 根据你的接口返回结构调整这里
            const imageUrl = response.data.url
            if (!imageUrl) {
                throw new Error("接口未返回图片地址");
            }
            return {
                "errorCode": 0,
                "data": {
                    "src": imageUrl,
                    "alt": file.name
                }
            };

        } catch (error) {
            console.error("上传出错:", error);
            // 必须抛出错误，编辑器才能知道失败了
            throw error;
        }
    },
}

export let fileSetting = {
    uploadUrl: "http://127.0.0.1:5120/upload/attachments",
 //@ts-ignore
    uploader: async (file, uploadUrl, headers, formName) => {
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response: any = await uploadAttachment(formData);
            // 根据你的接口返回结构调整这里
            const imageUrl = response.data.url
            if (!imageUrl) {
                throw new Error("接口未返回附件地址");
            }
            return {
                "errorCode": 0,
                "data": {
                    "href": imageUrl,
                    "fileName": file.name
                }
            };

        } catch (error) {
            console.error("上传出错:", error);
            // 必须抛出错误，编辑器才能知道失败了
            throw error;
        }
    },
    uploaderEvent: {
         //@ts-ignore
        onUploadBefore: (file, uploadUrl, headers) => {
            //监听视频上传之前，此方法可以不用回任何内容，但若返回 false，则终止上传
        },
         //@ts-ignore
        onSuccess: (file, response) => {
            //监听视频上传成功
            //注意：
            // 1、如果此方法返回 false，则视频不会被插入到编辑器
            // 2、可以在这里返回一个新的 json 给编辑器
        },
         //@ts-ignore
        onFailed: (file, response) => {
            //监听视频上传失败，或者返回的 json 信息不正确
        },
         //@ts-ignore
        onError: (file, error) => {
            //监听视频上传错误，比如网络超时等
        },
    }
}
export let videoSetting = {
    uploadUrl: "http://127.0.0.1:5120/upload/videos",
     //@ts-ignore
    uploader: async (file, uploadUrl, headers, formName) => {
        try {
            const formData = new FormData();
            formData.append("file", file);
            const response: any = await uploadVideo(formData);
            console.log(response, "rrrr")
            // 根据你的接口返回结构调整这里
            const imageUrl = response.data.url
            if (!imageUrl) {
                throw new Error("接口未返回视频地址");
            }
            return {
                "errorCode": 0,
                "data": {
                    "src": imageUrl,
                    "poster": ""
                }
            };

        } catch (error) {
            console.error("上传出错:", error);
            // 必须抛出错误，编辑器才能知道失败了
            throw error;
        }
    },
    uploaderEvent: {
         //@ts-ignore
        onUploadBefore: (file, uploadUrl, headers) => {
            //监听视频上传之前，此方法可以不用回任何内容，但若返回 false，则终止上传
        },
         //@ts-ignore
        onSuccess: (file, response) => {
            //监听视频上传成功
            //注意：
            // 1、如果此方法返回 false，则视频不会被插入到编辑器
            // 2、可以在这里返回一个新的 json 给编辑器
        },
         //@ts-ignore
        onFailed: (file, response) => {
            //监听视频上传失败，或者返回的 json 信息不正确
        },
         //@ts-ignore
        onError: (file, error) => {
            //监听视频上传错误，比如网络超时等
        },
    }
}