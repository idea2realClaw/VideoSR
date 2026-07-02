/**
 * VideoSR WebUI - 前端交互逻辑（调试版）
 * 添加了详细的控制台日志来帮助诊断上传问题
 */

// 全局状态和配置
const AppState = {
    currentFile: null,
    currentTaskId: null,
    uploadedFilePath: null,
    completedTaskId: null,
    settings: {
        scale: 4,
        model: 'basicvsr++',
        denoise: 2,
        format: 'mp4',
        keepFps: true,
        keepAudio: true,
        bitrate: 8,
        useNpu: true
    },
    isProcessing: false,
    progressInterval: null
};

// API基础URL - 显式指定，避免代理问题
const API_BASE = 'http://localhost:5000';

// DOM元素引用
let Elements = {};

// 初始化DOM引用
function initElements() {
    Elements = {
        uploadArea: document.getElementById('uploadArea'),
        uploadContent: document.getElementById('uploadContent'),
        uploadBtn: document.getElementById('uploadBtn'),
        fileInput: document.getElementById('fileInput'),
        
        previewSection: document.getElementById('previewSection'),
        originalVideo: document.getElementById('originalVideo'),
        resultVideo: document.getElementById('resultVideo'),
        resultPlaceholder: document.getElementById('resultPlaceholder'),
        originalInfo: document.getElementById('originalInfo'),
        resultInfo: document.getElementById('resultInfo'),
        removeVideo: document.getElementById('removeVideo'),
        
        settingsPanel: document.getElementById('settingsPanel'),
        settingsToggle: document.getElementById('settingsToggle'),
        settingsContent: document.getElementById('settingsContent'),
        denoiseLevel: document.getElementById('denoiseLevel'),
        denoiseValue: document.getElementById('denoiseValue'),
        advancedToggle: document.getElementById('advancedToggle'),
        advancedContent: document.getElementById('advancedContent'),
        keepFps: document.getElementById('keepFps'),
        keepAudio: document.getElementById('keepAudio'),
        bitrate: document.getElementById('bitrate'),
        
        actionSection: document.getElementById('actionSection'),
        startBtn: document.getElementById('startBtn'),
        progressSection: document.getElementById('progressSection'),
        progressTitle: document.getElementById('progressTitle'),
        progressPercent: document.getElementById('progressPercent'),
        progressFill: document.getElementById('progressFill'),
        progressStatus: document.getElementById('progressStatus'),
        progressProcessed: document.getElementById('progressProcessed'),
        progressEta: document.getElementById('progressEta'),
        cancelBtn: document.getElementById('cancelBtn'),
        completeSection: document.getElementById('completeSection'),
        completeInfo: document.getElementById('completeInfo'),
        downloadBtn: document.getElementById('downloadBtn'),
        newVideoBtn: document.getElementById('newVideoBtn'),
        
        themeToggle: document.getElementById('themeToggle'),
        toastContainer: document.getElementById('toastContainer'),
        loadingOverlay: document.getElementById('loadingOverlay'),
        loadingText: document.getElementById('loadingText')
    };
    
    console.log('DOM Elements initialized:', Elements);
}

// ==========================================
// 初始化
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('VideoSR initializing...');
    initElements();
    initTheme();
    initUpload();
    initSettings();
    initActions();
    initNavigation();
    console.log('VideoSR initialized successfully');
});

// ==========================================
// 主题切换
// ==========================================
function initTheme() {
    const savedTheme = localStorage.getItem('videosr-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    
    if (Elements.themeToggle) {
        Elements.themeToggle.addEventListener('click', function() {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('videosr-theme', newTheme);
            updateThemeIcon(newTheme);
        });
    }
}

function updateThemeIcon(theme) {
    if (Elements.themeToggle) {
        const icon = Elements.themeToggle.querySelector('.theme-icon');
        if (icon) {
            icon.textContent = theme === 'dark' ? '☀️' : '🌙';
        }
    }
}

// ==========================================
// 文件上传功能
// ==========================================
function initUpload() {
    console.log('Initializing upload...');
    
    // 检查必要的DOM元素
    if (!Elements.uploadArea) console.error('uploadArea not found');
    if (!Elements.fileInput) console.error('fileInput not found');
    if (!Elements.uploadBtn) console.error('uploadBtn not found');
    
    // 点击上传区域
    if (Elements.uploadArea) {
        Elements.uploadArea.addEventListener('click', function(e) {
            console.log('Upload area clicked');
            if (e.target.closest('.upload-btn') || e.target === Elements.uploadArea || 
                e.target.closest('.upload-content')) {
                if (Elements.fileInput) {
                    console.log('Triggering file input click');
                    Elements.fileInput.click();
                }
            }
        });
    }
    
    // 上传按钮
    if (Elements.uploadBtn) {
        Elements.uploadBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            console.log('Upload button clicked');
            if (Elements.fileInput) {
                Elements.fileInput.click();
            }
        });
    }
    
    // 文件选择
    if (Elements.fileInput) {
        Elements.fileInput.addEventListener('change', function(e) {
            console.log('File input change event triggered');
            console.log('Files:', e.target.files);
            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                console.log('Selected file:', file.name, file.size, file.type);
                handleFileSelect(file);
            } else {
                console.log('No file selected');
            }
        });
    } else {
        console.error('fileInput not found! Cannot attach change event');
    }
    
    // 拖拽上传
    if (Elements.uploadArea) {
        Elements.uploadArea.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            Elements.uploadArea.classList.add('drag-over');
        });
        
        Elements.uploadArea.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            Elements.uploadArea.classList.remove('drag-over');
        });
        
        Elements.uploadArea.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            Elements.uploadArea.classList.remove('drag-over');
            
            const files = e.dataTransfer.files;
            console.log('Files dropped:', files);
            if (files && files.length > 0) {
                handleFileSelect(files[0]);
            }
        });
    }
    
    // 移除视频
    if (Elements.removeVideo) {
        Elements.removeVideo.addEventListener('click', function() {
            resetToUpload();
        });
    }
}

async function handleFileSelect(file) {
    console.log('=== handleFileSelect called ===');
    console.log('File:', file.name, file.size, file.type);
    
    // 验证文件类型
    if (!file.type || !file.type.startsWith('video/')) {
        console.warn('Invalid file type:', file.type);
        showToast('error', '请选择有效的视频文件');
        return;
    }
    
    // 验证文件大小 (500MB)
    if (file.size > 500 * 1024 * 1024) {
        console.warn('File too large:', file.size);
        showToast('error', '文件大小超过500MB限制');
        return;
    }
    
    AppState.currentFile = file;
    
    // 显示加载状态
    showLoading('正在上传视频...');
    
    try {
        // 上传文件到服务器
        const formData = new FormData();
        formData.append('video', file);
        
        const uploadUrl = API_BASE + '/api/upload';
        console.log('Uploading to:', uploadUrl);
        
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });
        
        console.log('Upload response status:', response.status);
        console.log('Upload response ok:', response.ok);
        
        const responseText = await response.text();
        console.log('Upload response text:', responseText);
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse response as JSON:', parseError);
            throw new Error('服务器响应格式错误: ' + responseText.substring(0, 100));
        }
        
        console.log('Upload result:', result);
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || '上传失败');
        }
        
        hideLoading();
        
        // 显示视频预览
        showVideoPreview(file, result);
        
        showToast('success', '视频上传成功！');
        
    } catch (error) {
        hideLoading();
        console.error('=== Upload error ===');
        console.error('Error:', error);
        console.error('Error message:', error.message);
        showToast('error', '上传失败: ' + error.message);
    }
}

function showVideoPreview(file, uploadResult) {
    console.log('=== showVideoPreview called ===');
    console.log('Upload result:', uploadResult);
    
    // 隐藏上传区域
    if (Elements.uploadArea) {
        Elements.uploadArea.style.display = 'none';
    }
    
    // 显示预览区域
    if (Elements.previewSection) {
        Elements.previewSection.style.display = 'block';
    }
    
    // 显示设置面板
    if (Elements.settingsPanel) {
        Elements.settingsPanel.style.display = 'block';
    }
    
    // 显示操作区域
    if (Elements.actionSection) {
        Elements.actionSection.style.display = 'block';
    }
    
    // 设置原始视频预览
    if (Elements.originalVideo) {
        const objectUrl = URL.createObjectURL(file);
        Elements.originalVideo.src = objectUrl;
        Elements.originalVideo.load();
    }
    
    // 显示视频信息
    const fileSize = formatFileSize(file.size);
    if (Elements.originalInfo) {
        Elements.originalInfo.innerHTML = `
            <div>文件名: ${file.name}</div>
            <div>文件大小: ${fileSize}</div>
        `;
    }
    
    // 存储上传后的文件路径
    if (uploadResult && uploadResult.filePath) {
        AppState.uploadedFilePath = uploadResult.filePath;
        console.log('Stored file path:', AppState.uploadedFilePath);
    } else {
        console.error('No filePath in upload result!');
    }
}

function resetToUpload() {
    console.log('Resetting to upload...');
    
    // 停止所有视频播放
    if (Elements.originalVideo) {
        Elements.originalVideo.pause();
    }
    if (Elements.resultVideo) {
        Elements.resultVideo.pause();
    }
    
    // 释放Object URL
    if (Elements.originalVideo && Elements.originalVideo.src) {
        URL.revokeObjectURL(Elements.originalVideo.src);
    }
    
    // 重置状态
    AppState.currentFile = null;
    AppState.currentTaskId = null;
    AppState.uploadedFilePath = null;
    AppState.completedTaskId = null;
    
    // 显示上传区域
    if (Elements.uploadArea) {
        Elements.uploadArea.style.display = 'block';
    }
    
    // 隐藏其他区域
    if (Elements.previewSection) {
        Elements.previewSection.style.display = 'none';
    }
    if (Elements.settingsPanel) {
        Elements.settingsPanel.style.display = 'none';
    }
    if (Elements.actionSection) {
        Elements.actionSection.style.display = 'none';
    }
    if (Elements.progressSection) {
        Elements.progressSection.style.display = 'none';
    }
    if (Elements.completeSection) {
        Elements.completeSection.style.display = 'none';
    }
    
    // 重置文件输入
    if (Elements.fileInput) {
        Elements.fileInput.value = '';
    }
    
    // 重置结果视频
    if (Elements.resultVideo) {
        Elements.resultVideo.style.display = 'none';
    }
    if (Elements.resultPlaceholder) {
        Elements.resultPlaceholder.style.display = 'flex';
    }
}

// ==========================================
// 设置面板功能
// ==========================================
function initSettings() {
    console.log('Initializing settings...');
    
    // 放大倍数选择
    document.querySelectorAll('.scale-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.scale-btn').forEach(function(b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            AppState.settings.scale = parseInt(btn.dataset.scale);
            console.log('Scale set to:', AppState.settings.scale);
        });
    });
    
    // 模型选择
    document.querySelectorAll('.model-option').forEach(function(option) {
        option.addEventListener('click', function() {
            document.querySelectorAll('.model-option').forEach(function(o) {
                o.classList.remove('active');
            });
            option.classList.add('active');
            AppState.settings.model = option.dataset.model;
            console.log('Model set to:', AppState.settings.model);
        });
    });
    
    // 降噪级别
    if (Elements.denoiseLevel) {
        Elements.denoiseLevel.addEventListener('input', function() {
            const values = ['无', '低', '中', '高'];
            AppState.settings.denoise = parseInt(Elements.denoiseLevel.value);
            if (Elements.denoiseValue) {
                Elements.denoiseValue.textContent = values[AppState.settings.denoise];
            }
        });
    }
    
    // 输出格式
    document.querySelectorAll('.format-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.format-btn').forEach(function(b) {
                b.classList.remove('active');
            });
            btn.classList.add('active');
            AppState.settings.format = btn.dataset.format;
            console.log('Format set to:', AppState.settings.format);
        });
    });
    
    // 设置面板折叠
    if (Elements.settingsToggle) {
        Elements.settingsToggle.addEventListener('click', function() {
            const isCollapsed = Elements.settingsContent.style.display === 'none';
            Elements.settingsContent.style.display = isCollapsed ? 'block' : 'none';
            Elements.settingsToggle.classList.toggle('collapsed', !isCollapsed);
        });
    }
    
    // 高级设置折叠
    if (Elements.advancedToggle) {
        Elements.advancedToggle.addEventListener('click', function() {
            const isVisible = Elements.advancedContent.style.display === 'block';
            Elements.advancedContent.style.display = isVisible ? 'none' : 'block';
            const arrow = Elements.advancedToggle.querySelector('.advanced-arrow');
            if (arrow) {
                arrow.classList.toggle('open', !isVisible);
            }
        });
    }
    
    // 高级设置输入
    if (Elements.keepFps) {
        Elements.keepFps.addEventListener('change', function() {
            AppState.settings.keepFps = Elements.keepFps.checked;
        });
    }
    
    if (Elements.keepAudio) {
        Elements.keepAudio.addEventListener('change', function() {
            AppState.settings.keepAudio = Elements.keepAudio.checked;
        });
    }
    
    if (Elements.bitrate) {
        Elements.bitrate.addEventListener('change', function() {
            AppState.settings.bitrate = parseInt(Elements.bitrate.value) || 8;
        });
    }
}

// ==========================================
// 操作功能
// ==========================================
function initActions() {
    console.log('Initializing actions...');
    
    if (Elements.startBtn) {
        Elements.startBtn.addEventListener('click', startProcessing);
    }
    
    if (Elements.cancelBtn) {
        Elements.cancelBtn.addEventListener('click', cancelProcessing);
    }
    
    if (Elements.downloadBtn) {
        Elements.downloadBtn.addEventListener('click', downloadResult);
    }
    
    if (Elements.newVideoBtn) {
        Elements.newVideoBtn.addEventListener('click', resetToUpload);
    }
}

async function startProcessing() {
    console.log('=== startProcessing called ===');
    console.log('Uploaded file path:', AppState.uploadedFilePath);
    
    if (!AppState.uploadedFilePath) {
        showToast('error', '请先上传视频');
        return;
    }
    
    if (Elements.startBtn) {
        Elements.startBtn.disabled = true;
        Elements.startBtn.innerHTML = '<span>处理中...</span>';
    }
    
    // 显示进度区域
    if (Elements.progressSection) {
        Elements.progressSection.style.display = 'block';
    }
    if (Elements.completeSection) {
        Elements.completeSection.style.display = 'none';
    }
    
    try {
        const requestBody = {
            filePath: AppState.uploadedFilePath,
            settings: AppState.settings
        };
        console.log('Sending process request:', requestBody);
        
        const response = await fetch(API_BASE + '/api/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Process response status:', response.status);
        
        const result = await response.json();
        console.log('Process result:', result);
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || '启动处理失败');
        }
        
        AppState.currentTaskId = result.taskId;
        AppState.isProcessing = true;
        
        // 开始轮询进度
        startProgressPolling();
        
    } catch (error) {
        console.error('Start processing error:', error);
        showToast('error', '启动失败: ' + error.message);
        if (Elements.startBtn) {
            Elements.startBtn.disabled = false;
            Elements.startBtn.innerHTML = '<span class="btn-icon-left">✨</span><span>开始超分处理</span>';
        }
        if (Elements.progressSection) {
            Elements.progressSection.style.display = 'none';
        }
    }
}

function startProgressPolling() {
    console.log('Starting progress polling...');
    
    if (AppState.progressInterval) {
        clearInterval(AppState.progressInterval);
    }
    
    AppState.progressInterval = setInterval(async function() {
        if (!AppState.currentTaskId) return;
        
        try {
            const response = await fetch(API_BASE + '/api/task/' + AppState.currentTaskId);
            const task = await response.json();
            
            if (!response.ok) {
                throw new Error(task.message || '查询任务失败');
            }
            
            updateProgress(task);
            
            // 任务完成或失败
            if (task.status === 'completed' || task.status === 'failed') {
                clearInterval(AppState.progressInterval);
                AppState.isProcessing = false;
                
                if (task.status === 'completed') {
                    showCompletion(task);
                } else {
                    showError(task);
                }
            }
        } catch (error) {
            console.error('Progress polling error:', error);
        }
    }, 1000);
}

function updateProgress(task) {
    const percent = Math.round(task.progress || 0);
    
    if (Elements.progressFill) {
        Elements.progressFill.style.width = percent + '%';
    }
    if (Elements.progressPercent) {
        Elements.progressPercent.textContent = percent + '%';
    }
    
    if (Elements.progressStatus) {
        Elements.progressStatus.textContent = getStatusText(task.status);
    }
    if (Elements.progressTitle) {
        Elements.progressTitle.textContent = getProgressTitle(task.status);
    }
    
    if (task.processedFrames !== undefined && task.totalFrames !== undefined) {
        if (Elements.progressProcessed) {
            Elements.progressProcessed.textContent = task.processedFrames + ' / ' + task.totalFrames + ' 帧';
        }
    }
    
    if (task.eta !== undefined) {
        if (Elements.progressEta) {
            Elements.progressEta.textContent = formatDuration(task.eta);
        }
    }
}

function showCompletion(task) {
    console.log('=== showCompletion called ===');
    
    if (Elements.progressSection) {
        Elements.progressSection.style.display = 'none';
    }
    if (Elements.completeSection) {
        Elements.completeSection.style.display = 'block';
    }
    
    const outputPath = task.outputPath || '';
    const fileName = outputPath.split('/').pop() || 'output.mp4';
    
    if (Elements.completeInfo) {
        Elements.completeInfo.innerHTML = `
            增强视频已生成：<strong>${fileName}</strong>
            <br>输出分辨率: ${task.outputResolution || '未知'}
            <br>处理时间: ${formatDuration(task.processingTime || 0)}
        `;
    }
    
    const resultUrl = API_BASE + '/api/download/' + task.taskId;
    if (Elements.resultVideo) {
        Elements.resultVideo.src = resultUrl;
        Elements.resultVideo.style.display = 'block';
    }
    if (Elements.resultPlaceholder) {
        Elements.resultPlaceholder.style.display = 'none';
    }
    
    AppState.completedTaskId = task.taskId;
    
    if (Elements.startBtn) {
        Elements.startBtn.disabled = false;
        Elements.startBtn.innerHTML = '<span class="btn-icon-left">✨</span><span>开始超分处理</span>';
    }
    
    showToast('success', '视频超分处理完成！');
}

function showError(task) {
    console.log('=== showError called ===');
    
    if (Elements.progressSection) {
        Elements.progressSection.style.display = 'none';
    }
    if (Elements.completeSection) {
        Elements.completeSection.style.display = 'block';
        const icon = Elements.completeSection.querySelector('.complete-icon');
        const title = Elements.completeSection.querySelector('.complete-title');
        if (icon) icon.textContent = '❌';
        if (title) title.textContent = '处理失败';
        
        const info = Elements.completeSection.querySelector('.complete-info');
        if (info) info.textContent = task.error || '未知错误';
    }
    
    if (Elements.startBtn) {
        Elements.startBtn.disabled = false;
        Elements.startBtn.innerHTML = '<span class="btn-icon-left">✨</span><span>开始超分处理</span>';
    }
    
    showToast('error', '处理失败: ' + (task.error || '未知错误'));
}

async function cancelProcessing() {
    if (!AppState.currentTaskId) return;
    
    try {
        await fetch(API_BASE + '/api/task/' + AppState.currentTaskId + '/cancel', {
            method: 'POST'
        });
        
        clearInterval(AppState.progressInterval);
        AppState.isProcessing = false;
        
        if (Elements.progressSection) {
            Elements.progressSection.style.display = 'none';
        }
        if (Elements.startBtn) {
            Elements.startBtn.disabled = false;
            Elements.startBtn.innerHTML = '<span class="btn-icon-left">✨</span><span>开始超分处理</span>';
        }
        
        showToast('info', '处理已取消');
    } catch (error) {
        console.error('Cancel error:', error);
        showToast('error', '取消失败');
    }
}

async function downloadResult() {
    if (!AppState.completedTaskId) {
        showToast('error', '没有可下载的文件');
        return;
    }
    
    const downloadUrl = API_BASE + '/api/download/' + AppState.completedTaskId;
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'videosr_output_' + Date.now() + '.' + AppState.settings.format;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('success', '开始下载...');
}

// ==========================================
// 导航功能
// ==========================================
function initNavigation() {
    console.log('Initializing navigation...');
    
    document.querySelectorAll('.nav-link').forEach(function(link) {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            const target = document.getElementById(targetId);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
            
            document.querySelectorAll('.nav-link').forEach(function(l) {
                l.classList.remove('active');
            });
            link.classList.add('active');
        });
    });
}

// ==========================================
// 工具函数
// ==========================================
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
        return mins + '分' + secs + '秒';
    }
    return secs + '秒';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStatusText(status) {
    const statusMap = {
        'pending': '等待中',
        'preprocessing': '预处理中',
        'processing': '处理中',
        'postprocessing': '后处理中',
        'completed': '已完成',
        'failed': '失败',
        'cancelled': '已取消'
    };
    return statusMap[status] || status;
}

function getProgressTitle(status) {
    const titleMap = {
        'pending': '正在排队...',
        'preprocessing': '正在预处理视频...',
        'processing': '正在超分处理...',
        'postprocessing': '正在生成输出文件...',
        'completed': '处理完成！',
        'failed': '处理失败',
        'cancelled': '已取消'
    };
    return titleMap[status] || '正在处理...';
}

// ==========================================
// Toast通知
// ==========================================
function showToast(type, message, duration) {
    duration = duration || 4000;
    
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    if (Elements.toastContainer) {
        Elements.toastContainer.appendChild(toast);
    }
    
    setTimeout(function() {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            setTimeout(function() {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }
    }, duration);
}

// ==========================================
// 加载动画
// ==========================================
function showLoading(text) {
    text = text || '加载中...';
    if (Elements.loadingText) {
        Elements.loadingText.textContent = text;
    }
    if (Elements.loadingOverlay) {
        Elements.loadingOverlay.style.display = 'flex';
    }
}

function hideLoading() {
    if (Elements.loadingOverlay) {
        Elements.loadingOverlay.style.display = 'none';
    }
}

console.log('VideoSR app_debug.js loaded');
