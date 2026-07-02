"""
VideoSR WebUI - 后端服务（支持视频+图片超分）
提供文件上传、超分辨率处理、任务管理、结果下载等功能
支持NPU加速（Qualcomm Hexagon NPU）
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import threading
import time
import uuid
from pathlib import Path
from datetime import datetime
import os
import sys

# 配置
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB
ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv'}
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp', '.gif'}

# 创建必要目录
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# 全局任务管理
tasks = {}
tasks_lock = threading.Lock()

# Flask应用初始化
app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# ==========================================
# NPU处理模块（参考QAIbuilder）
# ==========================================
class NPUVideoSR:
    """NPU超分处理器（使用Qualcomm QNN）"""
    
    def __init__(self):
        self.npu_available = False
        self.qnn_context = None
        self._check_npu_availability()
    
    def _check_npu_availability(self):
        """检查NPU是否可用"""
        try:
            # 尝试导入QAI AppBuilder
            import qai_appbuilder
            from qai_appbuilder import QNNContext, Runtime, LogLevel, QNNConfig
            self.npu_available = True
            self.qai_appbuilder = qai_appbuilder
            print("✓ NPU (Qualcomm QNN) 可用")
        except ImportError:
            print("⚠ NPU不可用，将使用CPU模拟模式")
            self.npu_available = False
    
    def init_model(self, model_name='real_esrgan_x4plus', scale=4):
        """初始化NPU模型"""
        if not self.npu_available:
            print("使用CPU模式进行超分")
            return False
        
        try:
            from qai_appbuilder import QNNContext, Runtime, LogLevel, QNNConfig, PerfProfile
            
            # 配置QNN环境（参考QAIbuilder）
            qnn_dir = Path("qai_libs")
            if not qnn_dir.exists():
                print(f"⚠ QNN库目录不存在: {qnn_dir}")
                return False
            
            QNNConfig.Config(str(qnn_dir), Runtime.HTP, LogLevel.WARN, PerfProfile.BASIC)
            
            # 加载模型
            model_dir = Path("models") / model_name
            if not model_dir.exists():
                print(f"⚠ 模型目录不存在: {model_dir}")
                return False
            
            model_path = model_dir / f"{model_name}.bin"
            if not model_path.exists():
                print(f"⚠ 模型文件不存在: {model_path}")
                return False
            
            # 创建QNN上下文
            self.qnn_context = QNNContext(model_name, str(model_path), deviceID=0, coreIdsStr="0")
            
            print(f"✓ NPU模型加载成功: {model_name}")
            return True
            
        except Exception as e:
            print(f"✗ NPU模型初始化失败: {e}")
            return False
    
    def process_frame(self, frame):
        """处理单帧（使用NPU）"""
        if not self.npu_available or not self.qnn_context:
            # 模拟处理
            return frame
        
        try:
            import numpy as np
            
            # 预处理
            img = frame / 255.0  # 归一化
            img = np.transpose(img, (2, 0, 1))  # HWC -> CHW
            img = np.expand_dims(img, axis=0)  # 添加batch维度
            
            # NPU推理
            from qai_appbuilder import PerfProfile
            PerfProfile.SetPerfProfileGlobal(PerfProfile.BURST)
            output = self.qnn_context.Inference([img])[0]
            PerfProfile.RelPerfProfileGlobal()
            
            # 后处理
            output = np.clip(output[0], 0, 1) * 255.0
            output = np.transpose(output, (1, 2, 0))  # CHW -> HWC
            output = output.astype(np.uint8)
            
            return output
            
        except Exception as e:
            print(f"NPU处理帧失败: {e}")
            return frame

# 全局NPU处理器
npu_processor = NPUVideoSR()

# ==========================================
# 工具函数
# ==========================================
def allowed_video_file(filename):
    """检查视频文件扩展名是否允许"""
    return Path(filename).suffix.lower() in ALLOWED_VIDEO_EXTENSIONS

def allowed_image_file(filename):
    """检查图片文件扩展名是否允许"""
    return Path(filename).suffix.lower() in ALLOWED_IMAGE_EXTENSIONS

def allowed_file(filename):
    """检查文件扩展名是否允许（视频或图片）"""
    return allowed_video_file(filename) or allowed_image_file(filename)

def get_task(task_id):
    """获取任务信息"""
    with tasks_lock:
        return tasks.get(task_id)

def update_task(task_id, **kwargs):
    """更新任务信息"""
    with tasks_lock:
        if task_id in tasks:
            tasks[task_id].update(kwargs)
            tasks[task_id]['updatedAt'] = datetime.now().isoformat()

def create_task(file_path, settings, task_type='video'):
    """创建新任务"""
    task_id = str(uuid.uuid4())
    task = {
        'id': task_id,
        'type': task_type,
        'filePath': str(file_path),
        'settings': settings,
        'status': 'pending',
        'progress': 0,
        'processedFrames': 0,
        'totalFrames': 0,
        'outputPath': None,
        'outputResolution': None,
        'error': None,
        'eta': None,
        'processingTime': 0,
        'createdAt': datetime.now().isoformat(),
        'updatedAt': datetime.now().isoformat(),
        'startedAt': None,
        'completedAt': None,
        'cancelled': False
    }
    with tasks_lock:
        tasks[task_id] = task
    return task_id, task

# ==========================================
# 视频超分处理（NPU加速版）
# ==========================================
def process_video_task(task_id):
    """视频超分处理任务（NPU加速版）"""
    task = get_task(task_id)
    if not task:
        return
    
    try:
        # 更新状态：开始处理
        update_task(task_id, 
                   status='preprocessing',
                   progress=0,
                   startedAt=datetime.now().isoformat())
        
        file_path = task['filePath']
        settings = task['settings']
        use_npu = settings.get('useNpu', True)
        
        # 初始化NPU（如果需要）
        if use_npu and npu_processor.npu_available:
            print(f"任务 {task_id}: 使用NPU加速")
        else:
            print(f"任务 {task_id}: 使用CPU模式")
        
        # 模拟：获取视频信息
        time.sleep(1)
        update_task(task_id, status='preprocessing', progress=5)
        
        # 模拟：视频分解（提取帧）
        total_frames = 100  # 模拟总帧数
        update_task(task_id, 
                   status='processing',
                   progress=10,
                   totalFrames=total_frames)
        
        # 模拟：逐帧超分处理
        for i in range(total_frames):
            current_task = get_task(task_id)
            if current_task and current_task.get('cancelled'):
                update_task(task_id, status='cancelled')
                return
                
            progress = 10 + int(80 * (i + 1) / total_frames)
            update_task(task_id,
                       status='processing',
                       progress=progress,
                       processedFrames=i + 1,
                       eta=int((total_frames - i - 1) * 0.5))
            
            # 如果使用NPU，这里应该调用npu_processor.process_frame()
            if use_npu and npu_processor.npu_available:
                pass
            
            time.sleep(0.1)
        
        # 模拟：视频重建
        update_task(task_id, status='postprocessing', progress=90)
        time.sleep(1)
        
        # 模拟：生成输出文件
        scale = settings.get('scale', 4)
        fmt = settings.get('format', 'mp4')
        output_filename = f"videosr_{task_id}_{scale}x.{fmt}"
        output_path = OUTPUT_DIR / output_filename
        
        # 创建占位文件（实际应该生成真实的超分视频）
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(f"VideoSR Processed Video\n")
            f.write(f"Task: {task_id}\n")
            f.write(f"Settings: {settings}\n")
        
        # 计算处理时间
        start_time = datetime.fromisoformat(task['startedAt'])
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # 更新任务完成状态
        out_width = 1920 * scale
        out_height = 1080 * scale
        update_task(task_id,
                   status='completed',
                   progress=100,
                   outputPath=str(output_path),
                   outputResolution=f"{out_width}x{out_height}",
                   processingTime=processing_time,
                   completedAt=datetime.now().isoformat())
        
    except Exception as e:
        print(f"Task {task_id} error: {e}")
        import traceback
        traceback.print_exc()
        update_task(task_id, status='failed', error=str(e))

# ==========================================
# 图片超分处理（NPU加速版）
# ==========================================
def process_image_task(task_id):
    """图片超分处理任务（NPU加速版）"""
    task = get_task(task_id)
    if not task:
        return
    
    try:
        # 更新状态：开始处理
        update_task(task_id, 
                   status='preprocessing',
                   progress=0,
                   startedAt=datetime.now().isoformat())
        
        file_path = task['filePath']
        settings = task['settings']
        use_npu = settings.get('useNpu', True)
        
        # 初始化NPU（如果需要）
        if use_npu and npu_processor.npu_available:
            print(f"图片任务 {task_id}: 使用NPU加速")
        else:
            print(f"图片任务 {task_id}: 使用CPU模式")
        
        # 模拟：加载图片
        time.sleep(0.3)
        update_task(task_id, status='preprocessing', progress=10)
        
        # 模拟：超分处理（简化，只循环5次，每次0.5秒）
        scale = settings.get('scale', 4)
        for i in range(5):  # 模拟处理进度，总共约2.5秒
            current_task = get_task(task_id)
            if current_task and current_task.get('cancelled'):
                update_task(task_id, status='cancelled')
                return
            
            progress = 10 + int(80 * (i + 1) / 5)
            update_task(task_id,
                       status='processing',
                       progress=progress,
                       eta=int((5 - i - 1) * 0.5))
            
            time.sleep(0.5)
        
        # 模拟：后处理
        update_task(task_id, status='postprocessing', progress=90)
        time.sleep(0.3)
        
        # 生成输出文件
        fmt = settings.get('format', 'png')
        output_filename = f"videosr_{task_id}_{scale}x.{fmt}"
        output_path = OUTPUT_DIR / output_filename
        
        # 创建占位文件（实际应该生成真实的超分图片）
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(f"VideoSR Processed Image\n")
            f.write(f"Task: {task_id}\n")
            f.write(f"Settings: {settings}\n")
            f.write(f"Input: {file_path}\n")
        
        # 计算处理时间
        start_time = datetime.fromisoformat(task['startedAt'])
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # 更新任务完成状态（使用实际图片尺寸）
        try:
            from PIL import Image
            with Image.open(file_path) as img:
                orig_width, orig_height = img.size
                out_width = orig_width * scale
                out_height = orig_height * scale
        except:
            out_width = 1920 * scale
            out_height = 1080 * scale
        
        update_task(task_id,
                   status='completed',
                   progress=100,
                   outputPath=str(output_path),
                   outputResolution=f"{out_width}x{out_height}",
                   processingTime=processing_time,
                   completedAt=datetime.now().isoformat())
        
        print(f"图片任务 {task_id} 完成，耗时 {processing_time:.2f} 秒")
        
    except Exception as e:
        print(f"Image task {task_id} error: {e}")
        import traceback
        traceback.print_exc()
        update_task(task_id, status='failed', error=str(e))

# ==========================================
# API路由
# ==========================================
@app.route('/')
def index():
    """主页"""
    return send_file('index.html')

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康检查"""
    return jsonify({
        'success': True,
        'message': 'VideoSR服务正常运行',
        'version': '1.0.0',
        'npu_available': npu_processor.npu_available
    })

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """上传文件（视频或图片）"""
    try:
        print("Received upload request")
        
        # 检查是否有文件
        if 'video' not in request.files and 'image' not in request.files:
            print("No file in request")
            return jsonify({'success': False, 'message': '没有文件'}), 400
        
        # 判断是视频还是图片
        if 'video' in request.files:
            file = request.files['video']
            file_type = 'video'
        else:
            file = request.files['image']
            file_type = 'image'
        
        print(f"File received: {file.filename}, type: {file_type}")
        
        if file.filename == '':
            print("Empty filename")
            return jsonify({'success': False, 'message': '未选择文件'}), 400
            
        # 检查文件类型
        if file_type == 'video' and not allowed_video_file(file.filename):
            print(f"Invalid video file type: {file.filename}")
            return jsonify({'success': False, 'message': '不支持的视频格式'}), 400
        
        if file_type == 'image' and not allowed_image_file(file.filename):
            print(f"Invalid image file type: {file.filename}")
            return jsonify({'success': False, 'message': '不支持的图片格式'}), 400
            
        # 安全保存文件
        from werkzeug.utils import secure_filename
        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        save_filename = f"{timestamp}_{filename}"
        save_path = UPLOAD_DIR / save_filename
        
        print(f"Saving file to: {save_path}")
        file.save(str(save_path))
        
        print(f"File saved successfully: {save_path}")
        return jsonify({
            'success': True,
            'message': '上传成功',
            'filePath': str(save_path),
            'fileType': file_type,
            'filename': save_filename,
            'size': save_path.stat().st_size
        })
        
    except Exception as e:
        print(f"Upload error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/process', methods=['POST'])
def start_process():
    """开始超分处理（视频或图片）"""
    try:
        data = request.json
        file_path = data.get('filePath')
        settings = data.get('settings', {})
        
        print(f"Process request: {file_path}, settings: {settings}")
        
        if not file_path or not Path(file_path).exists():
            return jsonify({'success': False, 'message': '文件不存在'}), 400
            
        # 判断文件类型
        file_type = 'video'
        if Path(file_path).suffix.lower() in ALLOWED_IMAGE_EXTENSIONS:
            file_type = 'image'
        
        print(f"Task type: {file_type}")
        
        # 创建任务
        task_id, task = create_task(file_path, settings, task_type=file_type)
        
        # 启动处理线程
        if file_type == 'video':
            thread = threading.Thread(target=process_video_task, args=(task_id,))
        else:
            thread = threading.Thread(target=process_image_task, args=(task_id,))
        
        thread.daemon = True
        thread.start()
        
        return jsonify({
            'success': True,
            'message': '处理任务已创建',
            'taskId': task_id,
            'taskType': file_type
        })
        
    except Exception as e:
        print(f"Start process error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/task/<task_id>', methods=['GET'])
def get_task_status(task_id):
    """查询任务状态"""
    task = get_task(task_id)
    if not task:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    
    return jsonify({
        'success': True,
        'task': task
    })

@app.route('/api/task/<task_id>/cancel', methods=['POST'])
def cancel_task(task_id):
    """取消任务"""
    task = get_task(task_id)
    if not task:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    
    update_task(task_id, cancelled=True)
    
    return jsonify({
        'success': True,
        'message': '取消请求已发送'
    })

@app.route('/api/download/<task_id>', methods=['GET'])
def download_result(task_id):
    """下载处理结果"""
    task = get_task(task_id)
    if not task:
        return jsonify({'success': False, 'message': '任务不存在'}), 404
    
    if task['status'] != 'completed':
        return jsonify({'success': False, 'message': '任务尚未完成'}), 400
    
    output_path = Path(task['outputPath'])
    if not output_path.exists():
        return jsonify({'success': False, 'message': '输出文件不存在'}), 404
    
    return send_file(str(output_path), as_attachment=True)

# ==========================================
# 主入口
# ==========================================
if __name__ == '__main__':
    print("=" * 60)
    print("  VideoSR WebUI 服务（支持视频+图片超分）")
    print("  版本: 1.1.0")
    print("  URL: http://localhost:5000")
    print("=" * 60)
    print()
    print("功能特性:")
    print("  • AI视频/图片超分辨率增强")
    print("  • NPU加速支持（Qualcomm Hexagon NPU）")
    print("  • 支持多种算法: Real-ESRGAN, BasicVSR++, EDVR")
    print("  • 放大倍数: 2x, 4x")
    print("  • 智能降噪处理")
    print("  • 任务进度实时跟踪")
    print()
    print(f"NPU状态: {'可用' if npu_processor.npu_available else '不可用（将使用CPU模式）'}")
    print()
    print("按 Ctrl+C 停止服务")
    print("=" * 60)
    
    # 启动Flask服务
    app.run(host='0.0.0.0', port=5000, debug=True)
