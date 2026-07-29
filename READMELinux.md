## 国产系统项目环境安装

## 1.node版本推荐20.xx.xx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
npm -v
## 2.install依赖包可能会报错
 ⨯ node-gyp failed to rebuild '/home/THTF/shootrangepj/node_modules/@serialport/bindings-cpp'  failedTask=installAppDeps stackTrace=Error: node-gyp failed to rebuild '/home/THTF/shootrangepj/node_modules/@serialport/bindings-cpp'
## 针对2的报错检查电脑是否安装了python3
python3 --version
## 如果安装了还是报错
rm -rf node_modules
rm package-lock.json
npm install
## 3.install依赖包成功后进行打包测试
npm run build:linux
## 可能会出现如下报错，原因是电脑gcc版本太低
⨯ make: 进入目录“/home/THTF/shootrangepj/node_modules/@serialport/bindings-cpp/build”
  CXX(target) Release/obj.target/bindings/src/serialport.o
make：g++：命令未找到
make: *** [bindings.target.mk:125：Release/obj.target/bindings/src/serialport.o] 错误 127

## 升级gcc
g++ --version

sudo apt-get update
sudo apt-get install -y g++-10
sudo update-alternatives --install /usr/bin/g++ g++ /usr/bin/g++-10 60 --slave /usr/bin/gcc gcc /usr/bin/gcc-10

## 关闭命令终端重新打开终端 再次执行build
