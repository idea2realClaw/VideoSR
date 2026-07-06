"""
VideoSR WebUI - 后端服务（支持视频+图片超分，NPU加速）
提供文件上传、超分辨率处理、任务管理、结果下载等功能
支持NPU加速（Qualcomm Hexagon NPU）
集成 Real-ESRGAN x4plus 模型（来自 video-sr-npu Skill）
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
import numpy as np
import cv2
from PIL import Image

# 配置
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
MODELS_DIR = BASE_DIR / "models"
MAX_FILE_SIZE = 500 * 1024 * 1024  # 500MB
ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.avi', '.mov', '.mkv', '.webm', '.flv'}
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp', '.gif'}

# 配置日志
import logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('server_debug.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# 创建必要目录
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)
MODELS_DIR.mkdir(exist_ok=True)

# 全局任务管理
tasks = {}
tasks_lock = threading.Lock()

# Flask应用初始化
app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# 输出文件服务
@app.route('/outputs/<filename>')
def serve_output(filename):
    """提供输出文件的访问（用于预览）"""
    return send_file(str(OUTPUT_DIR / filename))

# ==========================================
# Real-ESRGAN NPU 超分引擎（来自 video-sr-npu Skill）
# ==========================================

MODEL_ID = "mnz1l2exq"
MODEL_NAME = "real_esrgan_x4plus"
IMAGE_SIZE = 512
SCALE = 4

class NPUSuperResEngine:
    """NPU super-resolution engine - load once, upsample many frames."""
    
    def __init__(self):
        self.npu_available = False
        self.model = None
        self._init_npu()
    
    def _init_npu(self):
        """初始化 NPU 引擎"""
        try:
            import qai_appbuilder
            from qai_appbuilder import QNNContext, QNNConfig, Runtime, LogLevel, ProfilingLevel, PerfProfile
            
            # 下载模型（如果不存在）
            model_path = self._download_model()
            if not model_path:
                print("⚠ 模型下载失败，将使用CPU模式")
                return
            
            # 配置 QNN 环境
            qnn_libs_dir = os.path.join(
                os.path.dirname(qai_appbuilder.__file__), "libs"
            )
            QNNConfig.Config(qnn_libs_dir, Runtime.HTP, LogLevel.WARN, ProfilingLevel.BASIC)
            
            # 加载模型
            self.model = QNNContext("realesrgan", model_path)
            self.npu_available = True
            self.PerfProfile = PerfProfile
            print("✓ NPU (Qualcomm QNN) 可用，模型加载成功")
            
        except ImportError:
            print("⚠ qai_appbuilder 未安装，将使用CPU模拟模式")
            self.npu_available = False
        except Exception as e:
            print(f"⚠ NPU初始化失败: {e}，将使用CPU模拟模式")
            self.npu_available = False
    
    def _download_model(self):
        """下载 Real-ESRGAN 模型"""
        model_path = MODELS_DIR / f"{MODEL_NAME}.bin"
        if model_path.exists():
            print(f"[OK] 模型已缓存: {model_path}")
            return str(model_path)
        
        try:
            import qai_hub
            from pathlib import Path
            
            print(f"[...] 下载 {MODEL_NAME} 模型...", flush=True)
            
            # 配置 qai-hub token
            HUB_TOKEN = "a916bc04400e033f60fdd73c615e5780e2ba206a"
            hub_config_dir = Path.home() / ".qai_hub"
            hub_config = hub_config_dir / "client.ini"
            
            # 保存原有配置（如果有）
            saved_config = None
            if hub_config.exists():
                saved_config = hub_config.read_text(encoding='utf-8')
            
            try:
                import subprocess
                subprocess.run(["qai-hub", "configure", "--api_token", HUB_TOKEN],
                              capture_output=True, shell=True, check=True)
                
                model = qai_hub.get_model(MODEL_ID)
                model.download(filename=str(model_path))
                print(f"[OK] 模型下载成功: {model_path}")
                
            finally:
                # 恢复原有配置
                if saved_config:
                    hub_config.write_text(saved_config, encoding='utf-8')
            
            return str(model_path) if model_path.exists() else None
            
        except Exception as e:
            print(f"[ERR] 模型下载失败: {e}")
            return None
    
    def upsample(self, frame_bgr):
        """
        使用 NPU 进行超分（支持任意尺寸，自动分块处理，带重叠融合）
        frame_bgr: BGR numpy array (H, W, 3)
        returns: BGR numpy array at 4x resolution
        """
        if not self.npu_available or not self.model:
            # CPU 模拟模式：使用 bicubic 插值
            h, w = frame_bgr.shape[:2]
            new_h, new_w = h * SCALE, w * SCALE
            return cv2.resize(frame_bgr, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

        from qai_appbuilder import PerfProfile

        # BGR -> RGB -> PIL
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        orig_image = Image.fromarray(rgb)
        orig_w, orig_h = orig_image.size

        # 输出画布（4x 尺寸）
        out_w = orig_w * SCALE
        out_h = orig_h * SCALE
        # 用 float64 累加避免精度问题，最后转 uint8
        result_accum = np.zeros((out_h, out_w, 3), dtype=np.float64)
        result_weight = np.zeros((out_h, out_w, 3), dtype=np.float64)

        tile_size = IMAGE_SIZE       # 512（模型输入）
        out_tile  = tile_size * SCALE  # 2048（模型输出）
        overlap   = 32               # 重叠像素（输入侧），输出侧 = 32*4 = 128

        # 计算分块位置（带重叠，最后一块对齐右/下边缘，无重复）
        def _tile_positions(dim, tile, ov):
            # 单边尺寸小于一块时，只取一块（从 0 开始；crop 时由 PIL 自动补黑边）
            if dim <= tile:
                return [0]
            pos = []
            step = tile - ov
            p = 0
            while p + tile <= dim:
                pos.append(p)
                p += step
            # 最后一块对齐边缘
            if pos[-1] + tile < dim:
                last = dim - tile
                if last not in pos:
                    pos.append(last)
            # 去重（保序）
            seen = set()
            unique = []
            for p in pos:
                if p not in seen:
                    seen.add(p)
                    unique.append(p)
            return unique

        x_positions = _tile_positions(orig_w, tile_size, overlap)
        y_positions = _tile_positions(orig_h, tile_size, overlap)

        for y in y_positions:
            for x in x_positions:
                # 取 512x512 块（边缘块左移/上移取完整块；小于512时从0开始，PIL补黑边）
                x_start = max(0, min(x, orig_w - tile_size))
                y_start = max(0, min(y, orig_h - tile_size))
                tile = orig_image.crop((x_start, y_start, x_start + tile_size, y_start + tile_size))

                # NPU 推理（输出 2048x2048）
                tile_sr = self._infer_tile(tile, PerfProfile)

                # 计算输出图上对应的位置（4x）
                out_x = x * SCALE
                out_y = y * SCALE

                # 生成融合权重（重叠区线性过渡，边界处权重=1）
                w_out = tile_sr.width
                h_out = tile_sr.height
                ov_out = overlap * SCALE  # 128
                x_blend = np.ones(w_out, dtype=np.float32)
                y_blend = np.ones(h_out, dtype=np.float32)
                if ov_out > 1:
                    # 左边界不是图像边界时，左侧 overlap 区权重从 0→1
                    if x_start > 0:
                        x_blend[:ov_out] = np.linspace(0, 1, ov_out)
                    # 右边界不是图像边界时，右侧 overlap 区权重从 1→0
                    if x_start + tile_size < orig_w:
                        x_blend[-ov_out:] = np.linspace(1, 0, ov_out)
                    if y_start > 0:
                        y_blend[:ov_out] = np.linspace(0, 1, ov_out)
                    if y_start + tile_size < orig_h:
                        y_blend[-ov_out:] = np.linspace(1, 0, ov_out)
                weight_2d = (y_blend[:, None] * x_blend[None, :]).astype(np.float64)
                weight_3d = np.repeat(weight_2d[:, :, None], 3, axis=2)

                sr_np = np.array(tile_sr).astype(np.float64) / 255.0

                # 累加到结果画布
                ry_end = min(out_y + h_out, out_h)
                rx_end = min(out_x + w_out, out_w)
                result_accum[out_y:ry_end, out_x:rx_end] += sr_np[:ry_end-out_y, :rx_end-out_x] * weight_3d[:ry_end-out_y, :rx_end-out_x]
                result_weight[out_y:ry_end, out_x:rx_end] += weight_3d[:ry_end-out_y, :rx_end-out_x]

        # 归一化（除权重）
        result_weight[result_weight == 0] = 1.0  # 避免除零
        result_final = (result_accum / result_weight * 255.0).clip(0, 255).astype(np.uint8)

        result_bgr = cv2.cvtColor(result_final, cv2.COLOR_RGB2BGR)
        return result_bgr

    def _infer_tile(self, image, PerfProfile):
        """NPU 推理单个 512x512 块，返回 2048x2048 PIL Image"""
        # 确保是 512x512
        if image.size != (IMAGE_SIZE, IMAGE_SIZE):
            resized = Image.new('RGB', (IMAGE_SIZE, IMAGE_SIZE), (0, 0, 0))
            resized.paste(image, (0, 0))
            image = resized

        img_np = np.array(image).astype(np.float32) / 255.0
        img_np = np.expand_dims(img_np, axis=0)

        PerfProfile.SetPerfProfileGlobal(PerfProfile.BURST)
        output = self.model.Inference([img_np])[0]
        PerfProfile.RelPerfProfileGlobal()

        output = output.reshape(IMAGE_SIZE * SCALE, IMAGE_SIZE * SCALE, 3)
        output = np.clip(output, 0.0, 1.0)
        output = (output * 255).astype(np.uint8)
        return Image.fromarray(output)
    
    def _resize_pad(self, image, dst_size):
        """Resize and pad image to dst_size (PIL-only, no torch)"""
        orig_w, orig_h = image.size
        dst_h, dst_w = dst_size
        # 计算缩放比（保持宽高比）
        h_ratio = dst_h / orig_h
        w_ratio = dst_w / orig_w
        scale = min(h_ratio, w_ratio)
        # 缩放
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)
        resized = image.resize((new_w, new_h), Image.BICUBIC)
        # 居中填充到 dst_size
        pad_h = dst_h - new_h
        pad_w = dst_w - new_w
        pad_top = pad_h // 2
        pad_left = pad_w // 2
        padded = Image.new('RGB', (dst_w, dst_h), (0, 0, 0))
        padded.paste(resized, (pad_left, pad_top))
        return padded, scale, (pad_left, pad_top)
    
    def _undo_resize_pad(self, image, orig_size_wh, scale, padding):
        """Undo resize and pad (PIL-only, no torch)"""
        dst_w, dst_h = image.size
        w, h = int(orig_size_wh[0]), int(orig_size_wh[1])
        pad_left = int(padding[0])
        pad_top = int(padding[1])
        # 裁剪掉填充区域
        cropped = image.crop((pad_left, pad_top, pad_left + w, pad_top + h))
        # 缩回到原始尺寸
        orig_size = (w, h)
        cropped = cropped.resize(orig_size, Image.BICUBIC)
        return cropped

# 全局 NPU 引擎
npu_engine = NPUSuperResEngine()

# ==========================================
# 光流运动补偿插值（来自 video-sr-npu Skill）
# ==========================================

def compute_bidirectional_flow(prev_orig, next_orig):
    """计算双向光流"""
    prev_gray = cv2.cvtColor(prev_orig, cv2.COLOR_BGR2GRAY)
    next_gray = cv2.cvtColor(next_orig, cv2.COLOR_BGR2GRAY)
    
    flow_fwd = cv2.calcOpticalFlowFarneback(
        prev_gray, next_gray, None,
        0.5, 3, 15, 3, 5, 1.2, 0
    )
    flow_bwd = cv2.calcOpticalFlowFarneback(
        next_gray, prev_gray, None,
        0.5, 3, 15, 3, 5, 1.2, 0
    )
    return flow_fwd, flow_bwd

def upscale_flow(flow, scale):
    """上采样光流场"""
    h, w = flow.shape[:2]
    new_h, new_w = h * scale, w * scale
    flow_up = cv2.resize(flow, (new_w, new_h), interpolation=cv2.INTER_LINEAR)
    flow_up[:, :, 0] *= scale
    flow_up[:, :, 1] *= scale
    return flow_up

def motion_compensated_interpolation(sr_prev, sr_next, orig_prev, orig_next, scale=SCALE):
    """运动补偿插值生成中间帧"""
    # 计算光流
    flow_fwd, flow_bwd = compute_bidirectional_flow(orig_prev, orig_next)
    
    # 上采样光流
    flow_fwd_sr = upscale_flow(flow_fwd, scale)
    flow_bwd_sr = upscale_flow(flow_bwd, scale)
    
    # 构建坐标网格
    h_sr, w_sr = sr_prev.shape[:2]
    y_coords, x_coords = np.mgrid[0:h_sr, 0:w_sr].astype(np.float32)
    
    # 前向扭曲
    map_x_prev = x_coords - 0.5 * flow_fwd_sr[:, :, 0]
    map_y_prev = y_coords - 0.5 * flow_fwd_sr[:, :, 1]
    warped_prev = cv2.remap(sr_prev, map_x_prev, map_y_prev,
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    
    # 后向扭曲
    map_x_next = x_coords - 0.5 * flow_bwd_sr[:, :, 0]
    map_y_next = y_coords - 0.5 * flow_bwd_sr[:, :, 1]
    warped_next = cv2.remap(sr_next, map_x_next, map_y_next,
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    
    # 融合
    mid = cv2.addWeighted(warped_prev, 0.5, warped_next, 0.5, 0)
    return mid

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
# 图片超分处理（真实 AI 超分）
# ==========================================
def process_image_task(task_id):
    """图片超分处理任务（使用 Real-ESRGAN）"""
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
        scale = settings.get('scale', 4)
        
        # 读取原始图片
        update_task(task_id, status='preprocessing', progress=10)
        
        with Image.open(file_path) as img:
            # 转换为RGB
            if img.mode in ('RGBA', 'P', 'LA'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                if 'A' in img.mode:
                    background.paste(img, mask=img.split()[-1])
                else:
                    background.paste(img)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            orig_w, orig_h = img.size
            update_task(task_id, status='processing', progress=20)
            
            # 使用 NPU 引擎进行超分
            # 将 PIL Image 转换为 BGR numpy array
            rgb_array = np.array(img)
            bgr_array = cv2.cvtColor(rgb_array, cv2.COLOR_RGB2BGR)
            
            update_task(task_id, status='processing', progress=30)
            
            # NPU 超分
            sr_bgr = npu_engine.upsample(bgr_array)
            
            update_task(task_id, status='processing', progress=80)
            
            # BGR -> RGB -> PIL
            sr_rgb = cv2.cvtColor(sr_bgr, cv2.COLOR_BGR2RGB)
            sr_img = Image.fromarray(sr_rgb)
            
            update_task(task_id, status='postprocessing', progress=90)
            
            # 保存输出文件（强制 JPG 格式，文件名：原图名称_SRx4.jpg）
            fmt = 'jpg'
            original_stem = Path(file_path).stem
            output_filename = f"{original_stem}_SRx{scale}.{fmt}"
            output_path = OUTPUT_DIR / output_filename
            
            save_kwargs = {}
            if fmt.lower() in ('jpg', 'jpeg'):
                save_kwargs['quality'] = 95
                save_kwargs['optimize'] = True
            
            sr_img.save(output_path, **save_kwargs)
        
        # 计算处理时间
        start_time = datetime.fromisoformat(task['startedAt'])
        processing_time = (datetime.now() - start_time).total_seconds()
        
        # 更新任务完成状态
        out_width = orig_w * scale
        out_height = orig_h * scale
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
# 视频超分处理（真实 NPU 加速）
# ==========================================
def process_video_task(task_id):
    """视频超分处理任务（NPU加速版，使用光流运动补偿插值）"""
    task = get_task(task_id)
    if not task:
        return
    
    cap = None
    out = None
    
    try:
        # 更新状态：开始处理
        update_task(task_id, 
                   status='preprocessing',
                   progress=0,
                   startedAt=datetime.now().isoformat())
        
        file_path = task['filePath']
        settings = task['settings']
        scale = settings.get('scale', 4)
        use_npu = settings.get('useNpu', True) and npu_engine.npu_available
        
        # 打开视频
        cap = cv2.VideoCapture(file_path)
        if not cap.isOpened():
            raise Exception(f"无法打开视频: {file_path}")
        
        src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        dst_w, dst_h = src_w * scale, src_h * scale
        
        # 限制输出分辨率（最大 1920x1080）
        max_w, max_h = 1920, 1080
        if dst_w > max_w or dst_h > max_h:
            # 计算缩放比例
            scale_w = max_w / dst_w
            scale_h = max_h / dst_h
            resize_scale = min(scale_w, scale_h)
            dst_w = int(dst_w * resize_scale)
            dst_h = int(dst_h * resize_scale)
            print(f"输出分辨率限制: {dst_w}x{dst_h}")
        
        print(f"视频超分: {src_w}x{src_h} -> {dst_w}x{dst_h}")
        
        print(f"视频超分: {src_w}x{src_h} -> {dst_w}x{dst_h} ({scale}x)")
        print(f"总帧数: {total_frames}, FPS: {fps:.2f}")
        
        update_task(task_id, 
                   status='preprocessing',
                   progress=5,
                   totalFrames=total_frames,
                   outputResolution=f"{dst_w}x{dst_h}")
        
        # 尝试创建 VideoWriter，如果失败则报错
        output_filename = f"videosr_{task_id}_{scale}x.mp4"
        temp_output_path = OUTPUT_DIR / f"temp_{output_filename}"
        output_path = OUTPUT_DIR / output_filename
        
        # 尝试多种编码格式
        fourcc_options = [
            ('mp4v', 'mp4'),
            ('avc1', 'mp4'),
            ('XVID', 'avi'),
            ('H264', 'mp4'),
        ]
        
        out = None
        for fourcc_code, ext in fourcc_options:
            test_path = OUTPUT_DIR / f"temp_{task_id}.{ext}"
            fourcc = cv2.VideoWriter_fourcc(*fourcc_code)
            test_out = cv2.VideoWriter(str(test_path), fourcc, fps, (dst_w, dst_h))
            if test_out.isOpened():
                out = test_out
                temp_output_path = test_path
                output_path = OUTPUT_DIR / f"videosr_{task_id}_{scale}x.{ext}"
                print(f"VideoWriter created with {fourcc_code}")
                break
            else:
                test_out.release()
        
        if not out or not out.isOpened():
            raise Exception("无法创建视频写入器，请检查 OpenCV 编码支持")
        
        update_task(task_id, status='processing', progress=10)
        
        # 处理帧
        t_start = time.time()
        frame_idx = 0
        npu_count = 0
        
        # 读取第一帧
        ret, frame0 = cap.read()
        if not ret:
            raise Exception("视频没有帧")
        
        # 第一帧：NPU 推理
        sr0 = npu_engine.upsample(frame0)
        out.write(sr0)
        npu_count += 1
        frame_idx = 1
        
        prev_sr = sr0
        prev_orig = frame0
        
        update_task(task_id, 
                   status='processing',
                   progress=10 + int(80 * frame_idx / total_frames),
                   processedFrames=frame_idx)
        
        # 处理剩余帧
        while True:
            current_task = get_task(task_id)
            if current_task and current_task.get('cancelled'):
                update_task(task_id, status='cancelled')
                cap.release()
                out.release()
                return
            
            # 读取奇数帧（用于光流计算）
            ret1, orig_mid = cap.read()
            if not ret1:
                break
            
            # 读取偶数帧（用于 NPU 推理）
            ret2, orig_next = cap.read()
            
            if ret2:
                # NPU 推理偶数帧
                sr_next = npu_engine.upsample(orig_next)
                npu_count += 1
                
                # 光流运动补偿插值奇数帧
                mid_frame = motion_compensated_interpolation(
                    prev_sr, sr_next, prev_orig, orig_next, scale=scale
                )
                
                # 写入奇数帧（插值）
                out.write(mid_frame)
                frame_idx += 1
                
                # 写入偶数帧（NPU）
                out.write(sr_next)
                frame_idx += 2
                
                # 更新状态
                prev_sr = sr_next
                prev_orig = orig_next
                
            else:
                # 最后一帧（奇数），复制前一帧的 SR 结果
                out.write(prev_sr)
                frame_idx += 1
                break
            
            # 更新进度
            if frame_idx % 10 == 0:
                progress = 10 + int(80 * frame_idx / total_frames)
                elapsed = time.time() - t_start
                eta = (elapsed / frame_idx) * (total_frames - frame_idx) if frame_idx > 0 else 0
                
                update_task(task_id,
                           status='processing',
                           progress=min(progress, 95),
                           processedFrames=frame_idx,
                           eta=int(eta))
        
        cap.release()
        out.release()
        
        # 计算处理时间
        processing_time = (datetime.now() - datetime.fromisoformat(task['startedAt'])).total_seconds()
        
        # 更新任务完成状态
        update_task(task_id,
                   status='completed',
                   progress=100,
                   outputPath=str(output_path),
                   outputResolution=f"{dst_w}x{dst_h}",
                   processingTime=processing_time,
                   completedAt=datetime.now().isoformat())
        
        print(f"视频任务 {task_id} 完成，耗时 {processing_time:.2f} 秒")
        print(f"  NPU 推理次数: {npu_count}")
        
    except Exception as e:
        print(f"Video task {task_id} error: {e}")
        import traceback
        traceback.print_exc()
        update_task(task_id, status='failed', error=str(e))
        
        if cap:
            cap.release()
        if out:
            out.release()

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
        'version': '2.0.0',
        'npu_available': npu_engine.npu_available,
        'model': MODEL_NAME
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
            
        # 判断文件类型（优先扩展名，失败时用 PIL 尝试打开）
        file_suffix = Path(file_path).suffix.lower()
        file_type = None
        if file_suffix in ALLOWED_IMAGE_EXTENSIONS:
            file_type = 'image'
        elif file_suffix in ALLOWED_VIDEO_EXTENSIONS:
            file_type = 'video'
        else:
            # 扩展名无法识别，尝试用 PIL 打开确认是否为图片
            try:
                with Image.open(file_path) as test_img:
                    test_img.verify()
                file_type = 'image'
                print(f"[INFO] 扩展名未识别，但成功以图片方式打开: {file_path}")
            except Exception:
                file_type = 'video'
                print(f"[WARN] 扩展名未识别，默认按视频处理: {file_path}")
        
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

@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    """前端心跳检测（每15秒）"""
    try:
        data = request.json or {}
        client_time = data.get('time', '')
        print(f"[HEARTBEAT] {datetime.now().strftime('%H:%M:%S')} client={client_time}", flush=True)
        return jsonify({'success': True, 'serverTime': datetime.now().isoformat()})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/frontend-log', methods=['POST'])
def frontend_log():
    """接收前端事件日志并打印到后台"""
    try:
        data = request.json or {}
        level = data.get('level', 'info')
        message = data.get('message', '')
        source = data.get('source', 'frontend')
        timestamp = datetime.now().strftime('%H:%M:%S')
        # 用不同前缀打印，方便 grep
        prefix = {
            'info': '[FRONTEND]',
            'warn': '[FRONTEND-WARN]',
            'error': '[FRONTEND-ERROR]',
            'event': '[FRONTEND-EVENT]',
            'click': '[FRONTEND-CLICK]',
        }.get(level, '[FRONTEND]')
        print(f"{timestamp} {prefix} {message}", flush=True)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

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
    
    # 根据文件类型设置正确的MIME类型
    import mimetypes
    mime_type, _ = mimetypes.guess_type(str(output_path))
    if not mime_type:
        mime_type = 'application/octet-stream'
    
    return send_file(str(output_path), 
                    as_attachment=True, 
                    mimetype=mime_type,
                    download_name=output_path.name)

# ==========================================
# 主入口
# ==========================================
if __name__ == '__main__':
    print("=" * 60)
    print("  VideoSR WebUI 服务（真实 AI 超分 + NPU 加速）")
    print("  版本: 2.0.0")
    print("  URL: http://localhost:5000")
    print("=" * 60)
    print()
    print("功能特性:")
    print("  • 真实 AI 视频/图片超分辨率增强（Real-ESRGAN x4plus）")
    print("  • NPU 加速支持（Qualcomm Hexagon NPU）")
    print("  • 光流运动补偿插值（奇数帧）")
    print("  • 放大倍数: 2x, 4x")
    print("  • 任务进度实时跟踪")
    print()
    print(f"NPU状态: {'可用 ✓' if npu_engine.npu_available else '不可用（将使用CPU模式）⚠'}")
    print(f"模型: {MODEL_NAME}")
    print()
    print("按 Ctrl+C 停止服务")
    print("=" * 60)
    
    # 启动Flask服务
    app.run(host='0.0.0.0', port=5000, debug=False)
