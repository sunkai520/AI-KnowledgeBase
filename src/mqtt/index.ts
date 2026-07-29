export const aedes = require('aedes')()
const httpServer = require('http').createServer()
const ws = require('websocket-stream')
const port = 1883;
const { BrowserWindow } = require('electron')
ws.createServer({ server: httpServer }, aedes.handle)
let clients = [] as any;
httpServer.listen(port, function () {
    console.log('mqtt over websocket server listening on port ', port)
})

// 身份验证
aedes.authenticate = function (_client, username, password, callback) {
    // with no error, successful be true
    // callback(error, successful)
    callback(null, (username === 'admin' && password.toString() === '123456'));
}

// 客户端连接
aedes.on('client', function (client) {
    console.log('Client Connected: \x1b[33m' + (client ? client.id : client) +
        '\x1b[0m', 'to broker', aedes.id);
    let index = searchIndex(client.id)
    if (index < 0) {
        client.my_topic = "";
        clients.push(client)
    }

});

// 客户端断开
aedes.on('clientDisconnect', function (client) {
    console.log('Client Disconnected: \x1b[31m' + (client ? client.id : client) +
        '\x1b[0m', 'to broker', aedes.id);
    let index = searchIndex(client.id)
    if (index >= 0) {
        clients.splice(index, 1);
        pushServerStatus();
    }
});
//订阅主题。该函数第一个参数是要订阅的主题； 第二个是用于处理收到的消息的函，它接受两个参数：packet 和 callback。packet 是一个 AedesPublishPacket 对象，表示收到的消息；callback 是一个函数，用于在消息处理完成后通知 aedes 服务器；第三个参数是订阅成功的回调函数
// aedes.subscribe("text", async function (packet, callback) {
//     callback();
// }, () => {
//     console.log("订阅myMsg成功");
// });

//处理收到的消息,我们订阅所有主题收到的消息都可以通过这个事件获取(我们可以把订阅收到消息的处理函数写在上面订阅主题函数的第二个参数里面，或者统一写在下面)
aedes.on("publish", async function (packet, client) {
    //packet.topic表示哪个主题，packet.payload是收到的数据，是一串二进制数据，我们需要用.toString()将它转化为字符串
    if (packet.topic === 'replay') {
        console.log("Received message:", packet.payload.toString());
        BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send('render-message', { key: "replayData", data: packet.payload.toString() })
        })
    }
})
function searchIndex(id) {
    let index = clients.findIndex((c) => {
        return c.id == id
    })
    return index
}
aedes.on("subscribe", function (subscriptions: any, client) {
    let index = searchIndex(client.id)
    if (!subscriptions || subscriptions.length == 0) {
        return
    }
    let item = subscriptions[0]
    if (index >= 0) {
        clients[index].my_topic = item.topic
    }
    pushServerStatus()
    // let matches = str;
})
function pushServerStatus() {
    let regex = /\d+/g;
    let bars = clients.map((c) => {
        let matches = c.my_topic.match(regex);
        if (matches && matches.length > 0) {
            return matches[0]
        }
    })
    console.log(bars, "bars");
    BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('render-message', { key: "serverStatus", data: bars })
    })
}
//发布主题
// setInterval(()=>{          //两秒发布一次
//     aedes.publish({
//         topic: "text",  //发布主题
//         payload: "yes,发送试一下",    //消息内容
//         qos: 1,            //MQTT消息的服务质量（quality of service）。服务质量是1，这意味着这个消息需要至少一次确认（ACK）才能被认为是传输成功
//         retain: false,     // MQTT消息的保留标志（retain flag），它用于控制消息是否应该被保留在MQTT服务器上，以便新的订阅者可以接收到它。保留标志是false，这意味着这个消息不应该被保留
//         cmd: "publish",    // MQTT消息的命令（command），它用于控制消息的类型。命令是"publish"，这意味着这个消息是一个发布消息
//         dup: false         //判断消息是否是重复的
//     }, (err) => {          //发布失败的回调
//         if (err) {
//             console.log('发布失败')
//         }
// 	});
// },2000)
// console.log(1111111, "111")
// 当需要释放端口时，可以调用这个函数
export function closeServer() {
    httpServer.close(() => {
        console.log(`socket关闭：Server is closed and the port ${port} is free`);
    });
}

export function publishTop(topic, value) {
    console.log(topic, "当前主题是")
    aedes.publish({
        topic: topic,  //发布主题
        payload: JSON.stringify(value),    //消息内容
        qos: 1,            //MQTT消息的服务质量（quality of service）。服务质量是1，这意味着这个消息需要至少一次确认（ACK）才能被认为是传输成功
        retain: false,     // MQTT消息的保留标志（retain flag），它用于控制消息是否应该被保留在MQTT服务器上，以便新的订阅者可以接收到它。保留标志是false，这意味着这个消息不应该被保留
        cmd: "publish",    // MQTT消息的命令（command），它用于控制消息的类型。命令是"publish"，这意味着这个消息是一个发布消息
        dup: false         //判断消息是否是重复的
    }, (err) => {          //发布失败的回调
        if (err) {
            console.log('发布失败')
        }
    });
}