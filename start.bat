@echo off
chcp 65001
echo ==========
echo  VideoSR 启动脚本
echo ==========
echo.

# 检查虚拟环境
if not exist "venv\Scripts\python.exe" (
    echo 创建虚拟环境...
    python -m venv venv
)

# 安装依赖
echo 安装依赖...
call venv\Scripts\pip install -r requirements.txt

# 检查NPU可用性
echo.
echo 检查NPU状态...
curl -s http://localhost:5000/api/health | findstr "npu_available"

# 启动服务
echo.
echo 启动VideoSR服务...
echo 访问地址: <ADDRESS_REMOVED>
echo.
call venv\Scripts\python.exe server.py

pause
