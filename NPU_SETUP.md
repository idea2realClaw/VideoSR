# VideoSR NPU加速配置指南

## 概述

VideoSR支持使用Qualcomm Hexagon NPU进行硬件加速的视频超分辨率处理。本指南参考[QAIbuilder](https://github.com/quic/ai-engine-direct-helper)项目的实现方式。

## NPU加速原理

### 技术栈

1. **QNNContext** - Qualcomm Neural Network上下文，用于加载和运行AI模型
2. **Runtime.HTP** - Hexagon Tensor Processor，即NPU硬件
3. **PerfProfile.BURST** - 性能模式，最大化NPU性能
4. **模型格式** - 支持.bin（QNN模型）和.onnx（ONNX模型）

### 处理流程

```
视频上传 → 视频分解（提取帧） → 逐帧超分（NPU加速） → 视频重建 → 结果下载
```

## 环境要求

### 硬件要求

- Qualcomm Snapdragon设备（如：Surface Pro X, Windows on ARM设备）
- Hexagon DSP/NPU支持

### 软件要求

- Python 3.8+ (ARM64版本）
- QAI AppBuilder
- 预训练的超分模型（如Real-ESRGAN）

## 安装步骤

### 1. 安装QAI AppBuilder

```bash
# 克隆QAIbuilder仓库
git clone https://github.com/quic/ai-engine-direct-helper.git
cd ai-engine-direct-helper

# 安装Python包
pip install -e python/

# 验证安装
python -c "import qai_appbuilder; print('QAI AppBuilder installed successfully')"
```

### 2. 下载预训练模型

```bash
# 进入Real-ESRGAN示例目录
cd samples/python/real_esrgan_x4plus/

# 下载模型（自动下载QNN格式的模型）
python real_esrgan_x4plus.py
```

### 3. 配置环境变量

**Windows (PowerShell)**：

```powershell
# 设置QNN库路径
$env:QAI_QNN_LIBS_DIR = "C:\path\to\qai_libs"

# 选择运行时（HTP = Hexagon NPU）
$env:QAI_QNN_RUNTIME = "HTP"

# 设置性能模式（BURST = 最大性能）
$env:QAI_QNN_PERF_PROFILE = "BURST"

# 可选：IO配置路径
$env:QAI_IO_CONFIG = "C:\path\to\io_config.yaml"
```

**Windows (命令提示符)**：

```cmd
set QAI_QNN_LIBS_DIR=C:\path\to\qai_libs
set QAI_QNN_RUNTIME=HTP
set QAI_QNN_PERF_PROFILE=BURST
```

**Linux**：

```bash
export QAI_QNN_LIBS_DIR=/path/to/qai_libs
export QAI_QNN_RUNTIME=HTP
export QAI_QNN_PERF_PROFILE=BURST
```

## VideoSR中的NPU配置

### 1. 检查NPU可用性

启动VideoSR服务后，访问健康检查接口：

```bash
curl http://localhost:5000/api/health
```

响应示例（NPU可用）：

```json
{
  "success": true,
  "message": "VideoSR服务正常运行",
  "version": "1.0.0",
  "npu_available": true
}
```

响应示例（NPU不可用）：

```json
{
  "success": true,
  "message": "VideoSR服务正常运行",
  "version": "1.0.0",
  "npu_available": false
}
```

### 2. 启用NPU加速

在前端界面中：

1. 上传视频文件
2. 在"超分设置"面板中，确保"使用NPU加速"选项已启用（默认启用）
3. 点击"开始超分处理"

后端会自动检测NPU可用性：
- 如果NPU可用，将使用QNNContext进行硬件加速
- 如果NPU不可用，将回退到CPU模拟模式

### 3. 自定义NPU处理

如果要使用特定的超分模型，修改`server.py`中的`NPUVideoSR`类：

```python
# 初始化NPU模型
npu_processor.init_model(
    model_name='real_esrgan_x4plus',  # 模型名称
    scale=4  # 放大倍数
)

# 处理单帧
output_frame = npu_processor.process_frame(input_frame)
```

## 性能优化

### 1. 使用BURST性能模式

```python
from qai_appbuilder import PerfProfile

# 爆发模式（最大性能）
PerfProfile.SetPerfProfileGlobal(PerfProfile.BURST)

# 运行推理
output = context.Inference(input_data)

# 恢复默认模式
PerfProfile.RelPerfProfileGlobal()
```

### 2. 批处理

如果有多个视频需要处理，可以复用QNNContext：

```python
# 初始化一次
context = QNNContext("model", model_path, deviceID=0)

# 处理多个视频
for video in videos:
    result = process_video(video, context)
```

### 3. 多线程处理

```python
import threading

# 每个线程使用独立的QNNContext
def process_video_thread(video_path):
    context = QNNContext("model", model_path, deviceID=0)
    # 处理视频...
```

## 故障排除

### NPU不可用

**问题**：日志显示"NPU不可用，将使用CPU模拟模式"

**解决方案**：

1. 确认在Qualcomm Snapdragon设备上运行
2. 验证QAI AppBuilder已正确安装
3. 检查QNN库路径是否正确
4. 确保模型文件（.bin）存在

**调试步骤**：

```python
try:
    import qai_appbuilder
    print("✓ qai_appbuilder imported successfully")
    
    from qai_appbuilder import QNNContext
    print("✓ QNNContext available")
    
    # 测试模型加载
    context = QNNContext("test", model_path, deviceID=0)
    print("✓ Model loaded successfully")
    
except ImportError as e:
    print(f"✗ Import error: {e}")
    print("Please install QAI AppBuilder")
    
except Exception as e:
    print(f"✗ Error: {e}")
```

### 模型加载失败

**问题**：无法加载.bin模型文件

**解决方案**：

1. 检查模型文件路径是否正确
2. 确认QNN库路径已设置
3. 验证模型文件完整性
4. 查看详细错误信息

```python
import traceback

try:
    context = QNNContext("model", model_path, deviceID=0)
except Exception as e:
    print(f"Error: {e}")
    traceback.print_exc()
```

### 性能不佳

**问题**：NPU处理速度不理想

**解决方案**：

1. 启用BURST性能模式
2. 检查模型是否针对NPU优化
3. 使用批处理减少初始化开销
4. 考虑使用更轻量的模型

## 示例代码

### 完整的NPU视频超分示例

```python
from qai_appbuilder import (
    QNNContext, Runtime, LogLevel, 
    ProfilingLevel, PerfProfile, QNNConfig
)

# 1. 配置QNN环境
QNNConfig.Config(
    str(qnn_dir),      # QNN库路径
    Runtime.HTP,         # 使用Hexagon NPU
    LogLevel.WARN,      # 日志级别
    ProfilingLevel.BASIC  # 性能分析级别
)

# 2. 创建模型上下文
context = QNNContext(
    "realesrgan",      # 图名称
    str(model_path),    # 模型文件路径
    deviceID=0,         # 设备ID
    coreIdsStr="0"       # 核心ID
)

# 3. 获取模型信息
input_shapes = context.getInputShapes()
output_shapes = context.getOutputShapes()
print(f"Input shapes: {input_shapes}")
print(f"Output shapes: {output_shapes}")

# 4. 预处理输入
input_tensor = preprocess_image(image)  # [N, C, H, W]

# 5. 启用爆发模式
PerfProfile.SetPerfProfileGlobal(PerfProfile.BURST)

# 6. 运行推理
output_tensor = context.Inference([input_tensor])[0]

# 7. 恢复默认模式
PerfProfile.RelPerfProfileGlobal()

# 8. 后处理输出
output_image = postprocess_output(output_tensor)
```

## 参考资源

- [QAIbuilder GitHub](https://github.com/quic/ai-engine-direct-helper)
- [Qualcomm AI Stack](https://developer.qualcomm.com/software/qualcomm-ai-stack)
- [QNN SDK文档](https://developer.qualcomm.com/software/qualcomm-neural-processing-sdk)

## 下一步

1. 在Qualcomm设备上部署VideoSR
2. 下载并配置Real-ESRGAN模型
3. 测试NPU加速效果
4. 优化处理性能
5. 添加更多超分算法支持

---

**注意**：当前实现为模拟版本。要在真实NPU上运行，需要在Qualcomm Snapdragon设备上部署，并安装QAI AppBuilder。
