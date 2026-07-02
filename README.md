# VideoSR - AI视频超分辨率增强工具（NPU加速版）

## 功能特性

- 🎬 **AI视频超分辨率** - 使用先进AI模型提升视频画质
- ⚡ **NPU加速支持** - 支持Qualcomm Hexagon NPU硬件加速
- 🔧 **多种超分算法** - Real-ESRGAN, BasicVSR++, EDVR, Waifu2x
- 📊 **放大倍数** - 支持2x, 4x放大
- 🎨 **智能降噪** - 多级别降噪处理
- 📊 **实时进度跟踪** - 显示处理进度、已处理帧数、预计剩余时间
- 💾 **结果下载** - 处理完成后可下载增强视频

## 项目结构

```
VideoSR/
├── index.html          # 主页面
├── static/
│   ├── style.css     # 样式文件
│   └── app.js        # 前端逻辑（已修复文件选择问题）
├── server.py          # 后端服务（支持NPU加速）
├── requirements.txt    # Python依赖
├── setup.py          # 安装脚本
├── venv/              # 虚拟环境（自动创建）
├── uploads/          # 上传文件目录
└── outputs/          # 输出文件目录
```

## 快速开始

### 1. 创建虚拟环境并安装依赖

```bash
# 创建虚拟环境
python -m venv venv

# 安装依赖
venv\Scripts\pip install -r requirements.txt
```

### 2. 启动服务

```bash
# 使用虚拟环境启动
venv\Scripts\python.exe server.py

# 或直接启动（如果已安装依赖）
python server.py
```

服务启动后访问：`http://localhost:5000`

### 3. 使用应用

1. 打开浏览器访问 `http://localhost:5000`
2. 拖拽或点击上传视频文件
3. 调整超分设置（放大倍数、算法等）
4. 点击"开始超分处理"
5. 等待处理完成
6. 下载增强后的视频

## NPU加速配置（Qualcomm Snapdragon）

### 前置要求

- Qualcomm Snapdragon设备（如Windows on ARM设备）
- 安装QAI AppBuilder
- 下载预训练的超分模型

### 安装QAI AppBuilder

```bash
# 下载QAI AppBuilder
git clone https://github.com/quic/ai-engine-direct-helper.git
cd ai-engine-direct-helper

# 安装Python包
pip install -e python/

# 下载示例模型（如Real-ESRGAN）
python samples/python/real_esrgan_x4plus/download_model.py
```

### 配置NPU环境

1. **设置QNN库路径**：
   ```bash
   set QAI_QNN_LIBS_DIR=C:\path\to\qai_libs
   ```

2. **选择运行时**：
   ```bash
   set QAI_QNN_RUNTIME=HTP  # 使用Hexagon NPU
   ```

3. **设置性能模式**：
   ```bash
   set QAI_QNN_PERF_PROFILE=BURST  # 最大性能
   ```

### 使用NPU进行视频超分

应用会自动检测NPU可用性：
- 如果NPU可用，将使用QNNContext进行硬件加速
- 如果NPU不可用，将回退到CPU模拟模式

查看NPU状态：
```bash
curl http://localhost:5000/api/health
```

响应示例：
```json
{
  "success": true,
  "npu_available": true,
  "message": "VideoSR服务正常运行",
  "version": "1.0.0"
}
```

## API接口

### 健康检查
```bash
GET /api/health
```

### 上传视频
```bash
POST /api/upload
Content-Type: multipart/form-data

file: <video_file>
```

### 开始处理
```bash
POST /api/process
Content-Type: application/json

{
  "filePath": "path/to/uploaded/video.mp4",
  "settings": {
    "scale": 4,
    "model": "real_esrgan",
    "denoise": 2,
    "format": "mp4",
    "useNpu": true
  }
}
```

### 查询任务状态
```bash
GET /api/task/<task_id>
```

### 下载结果
```bash
GET /api/download/<task_id>
```

## 技术实现

### NPU加速原理（参考QAIbuilder）

应用使用以下技术栈实现NPU加速：

1. **QNNContext** - Qualcomm Neural Network上下文，用于加载和运行模型
2. **Runtime.HTP** - Hexagon Tensor Processor，即NPU硬件
3. **PerfProfile.BURST** - 性能模式，最大化NPU性能
4. **模型格式** - 支持.bin（QNN模型）和.onnx（ONNX模型）

### 处理流程

1. **视频上传** → 保存到uploads/目录
2. **视频分解** → 提取视频帧
3. **逐帧超分** → 使用NPU加速（如果可用）
4. **视频重建** → 合成输出视频
5. **结果下载** → 从outputs/目录下载

## 故障排除

### 文件选择后无反应

**问题**：选择视频文件后没有任何反应

**解决方案**：
1. 检查浏览器控制台（F12）查看错误信息
2. 确认server.py正在运行
3. 检查CORS设置（开发环境已启用）
4. 查看server.log日志文件

**已修复**：新版app.js已添加详细的错误日志和调试信息

### NPU不可用

**问题**：日志显示"NPU不可用，将使用CPU模拟模式"

**解决方案**：
1. 确认在Qualcomm Snapdragon设备上运行
2. 安装QAI AppBuilder
3. 设置正确的QNN库路径
4. 下载并配置超分模型

### 上传失败

**问题**：视频上传失败

**解决方案**：
1. 检查文件格式（支持：mp4, avi, mov, mkv, webm, flv）
2. 检查文件大小（最大500MB）
3. 查看server.log获取详细错误

## 开发说明

### 前端调试

打开浏览器控制台（F12），应用会输出详细的调试信息：
- `VideoSR initializing...` - 应用初始化
- `File selected:` - 文件选择
- `Uploading to:` - 上传请求
- `Starting processing...` - 开始处理

### 后端调试

查看server.log文件或控制台输出：
- 上传请求详情
- 处理进度
- NPU状态
- 错误信息

## 参考项目

本项目的NPU实现参考了[QAIbuilder](https://github.com/quic/ai-engine-direct-helper)项目：
- QNNContext使用方式
- Runtime配置方法
- 模型加载和推理流程
- 性能优化策略

## 许可证

MIT License

## 联系方式

- 项目主页：https://github.com/yourusername/VideoSR
- 问题反馈：https://github.com/yourusername/VideoSR/issues
