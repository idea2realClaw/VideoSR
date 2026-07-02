"""
VideoSR 测试脚本
测试文件上传和视频超分处理功能
"""

import requests
import time
import json
from pathlib import Path
import sys

BASE_URL = "http://localhost:5000"

def test_health():
    """测试健康检查"""
    print("=" * 60)
    print("测试1: 健康检查")
    print("=" * 60)
    
    try:
        response = requests.get(f"{BASE_URL}/api/health")
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.json()}")
        
        if response.status_code == 200:
            print("✓ 健康检查通过")
            return True
        else:
            print("✗ 健康检查失败")
            return False
            
    except Exception as e:
        print(f"✗ 错误: {e}")
        return False

def test_upload(video_path):
    """测试视频上传"""
    print("\n" + "=" * 60)
    print("测试2: 视频上传")
    print("=" * 60)
    
    if not Path(video_path).exists():
        print(f"✗ 测试视频不存在: {video_path}")
        print("提示: 请创建一个测试视频文件")
        return None
    
    try:
        with open(video_path, 'rb') as f:
            files = {'video': f}
            print(f"上传文件: {video_path}")
            response = requests.post(f"{BASE_URL}/api/upload", files=files)
            
        print(f"状态码: {response.status_code}")
        print(f"响应: {response.json()}")
        
        if response.status_code == 200 and response.json().get('success'):
            print("✓ 上传成功")
            return response.json()
        else:
            print("✗ 上传失败")
            return None
            
    except Exception as e:
        print(f"✗ 错误: {e}")
        return None

def test_process(file_path):
    """测试视频处理"""
    print("\n" + "=" * 60)
    print("测试3: 视频超分处理")
    print("=" * 60)
    
    try:
        data = {
            'filePath': file_path,
            'settings': {
                'scale': 4,
                'model': 'basicvsr++',
                'denoise': 2,
                'format': 'mp4',
                'useNpu': False  # 不使用NPU（模拟模式）
            }
        }
        
        print(f"开始处理: {file_path}")
        response = requests.post(
            f"{BASE_URL}/api/process",
            json=data
        )
        
        print(f"状态码: {response.status_code}")
        result = response.json()
        print(f"响应: {result}")
        
        if response.status_code == 200 and result.get('success'):
            print("✓ 处理任务已创建")
            task_id = result['taskId']
            print(f"任务ID: {task_id}")
            
            # 轮询任务状态
            print("\n等待处理完成...")
            while True:
                time.sleep(2)
                task_response = requests.get(f"{BASE_URL}/api/task/{task_id}")
                task = task_response.json()['task']
                
                status = task['status']
                progress = task['progress']
                print(f"状态: {status}, 进度: {progress}%")
                
                if status in ['completed', 'failed', 'cancelled']:
                    break
            
            if status == 'completed':
                print("✓ 处理完成")
                print(f"输出文件: {task['outputPath']}")
                print(f"输出分辨率: {task['outputResolution']}")
                print(f"处理时间: {task['processingTime']:.2f}秒")
                return task
            else:
                print(f"✗ 处理失败: {task.get('error', '未知错误')}")
                return None
        else:
            print("✗ 启动处理失败")
            return None
            
    except Exception as e:
        print(f"✗ 错误: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_download(task_id):
    """测试结果下载"""
    print("\n" + "=" * 60)
    print("测试4: 结果下载")
    print("=" * 60)
    
    try:
        print(f"下载任务: {task_id}")
        response = requests.get(f"{BASE_URL}/api/download/{task_id}", stream=True)
        
        if response.status_code == 200:
            output_file = f"test_output_{task_id}.txt"
            with open(output_file, 'wb') as f:
                for chunk in response.iter_content(chunk_size=1024):
                    if chunk:
                        f.write(chunk)
            
            print(f"✓ 下载成功: {output_file}")
            return True
        else:
            print(f"✗ 下载失败: {response.status_code}")
            print(f"响应: {response.text}")
            return False
            
    except Exception as e:
        print(f"✗ 错误: {e}")
        return False

def main():
    """主测试流程"""
    print("=" * 60)
    print("  VideoSR 功能测试")
    print("=" * 60)
    
    # 测试1: 健康检查
    if not test_health():
        print("\n✗ 服务未运行，请先启动 server.py")
        print("  命令: python server.py")
        return
    
    # 测试2: 上传（需要测试视频）
    test_video = "test_video.mp4"
    
    # 如果没有测试视频，创建一个占位文件
    if not Path(test_video).exists():
        print(f"\n提示: 未找到测试视频 {test_video}")
        print("创建占位文件用于测试...")
        with open(test_video, 'w') as f:
            f.write("This is a test video placeholder")
    
    upload_result = test_upload(test_video)
    
    if not upload_result:
        print("\n✗ 上传测试失败")
        return
    
    # 测试3: 处理
    file_path = upload_result['filePath']
    task = test_process(file_path)
    
    if not task:
        print("\n✗ 处理测试失败")
        return
    
    # 测试4: 下载
    test_download(task['id'])
    
    print("\n" + "=" * 60)
    print("  测试完成")
    print("=" * 60)

if __name__ == '__main__':
    main()
