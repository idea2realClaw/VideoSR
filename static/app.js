/**
 * VideoSR WebUI - 前端交互逻辑（支持视频+图片）
 * 功能：文件上传、预览、超分处理、进度跟踪、结果下载
 */

// ==========================================
// 全局状态和配置
// ==========================================
const AppState = {
    mode: 'video', // 'video' or 'image'
    currentFile: null,
    currentTaskId: null,
    uploadedFilePath: null,
    completedTaskId: null,
    settings: {
        scale: 4,
        model: 'basicvsr++',
        denoise: 2,
        format: 'mp4', // for video: mp4/webm/mkv, for image: png/jpg/webp
        keepFps: true,
        keepAudio: true,
        bitrate: 8,
        useNpu: true
    },
    isProcessing: false,
    progressInterval: null
};

// API基础URL - 使用相对路径，自动适配当前域名和端口
const API_BASE = '';

// ==========================================
// DOM元素引用
// ==========================================
const Elements = {};

function initElements() {
    Elements.modeSwitcher = document.querySelector('.mode-switcher');
    Elements.videoModeBtn = document.getElementById('videoModeBtn');
    Elements.imageModeBtn = document.getElementById('imageModeBtn');
    
    Elements.uploadArea = document.getElementById('uploadArea');
    Elements.uploadContent = document.getElementById('uploadContent');
    Elements.uploadBtn = document.getElementById('uploadBtn');
    Elements.fileInput = document.getElementById('fileInput');
    Elements.uploadTitle = document.getElementById('uploadTitle');
    Elements.uploadFormats = document.getElementById('uploadFormats');
    Elements.uploadLimit = document.getElementById('uploadLimit');
    Elements.uploadBtnText = document.getElementById('uploadBtnText');
    Elements.heroSubtitle = document.getElementById('heroSubtitle');
    
    // 视频预览
    Elements.videoPreviewSection = document.getElementById('videoPreviewSection');
    Elements.originalVideo = document.getElementById('originalVideo');
    Elements.resultVideo = document.getElementById('resultVideo');
    Elements.videoResultPlaceholder = document.getElementById('videoResultPlaceholder');
    Elements.originalVideoInfo = document.getElementById('originalVideoInfo');
    Elements.resultVideoInfo = document.getElementById('resultVideoInfo');
    Elements.removeVideo = document.getElementById('removeVideo');
    
    // 图片预览
    Elements.imagePreviewSection = document.getElementById('imagePreviewSection');
    Elements.originalImage = document.getElementById('originalImage');
    Elements.resultImage = document.getElementById('resultImage');
    Elements.resultImageWrapper = document.getElementById('resultImageWrapper');
    Elements.imageResultPlaceholder = document.getElementById('imageResultPlaceholder');
    Elements.originalImageInfo = document.getElementById('originalImageInfo');
    Elements.resultImageInfo = document.getElementById('resultImageInfo');
    Elements.removeImage = document.getElementById('removeImage');
    
    // 设置面板
    Elements.settingsPanel = document.getElementById('settingsPanel');
    Elements.settingsToggle = document.getElementById('settingsToggle');
    Elements.settingsContent = document.getElementById('settingsContent');
    Elements.denoiseLevel = document.getElementById('denoiseLevel');
    Elements.denoiseValue = document.getElementById('denoiseValue');
    Elements.imageFormatGroup = document.getElementById('imageFormatGroup');
    Elements.videoFormatGroup = document.getElementById('videoFormatGroup');
    Elements.videoAdvancedSettings = document.getElementById('videoAdvancedSettings');
    Elements.advancedToggle = document.getElementById('advancedToggle');
    Elements.advancedContent = document.getElementById('advancedContent');
    Elements.keepFps = document.getElementById('keepFps');
    Elements.keepAudio = document.getElementById('keepAudio');
    Elements.bitrate = document.getElementById('bitrate');
    
    // 操作区域
    Elements.actionSection = document.getElementById('actionSection');
    Elements.startBtn = document.getElementById('startBtn');
    Elements.startBtnText = document.getElementById('startBtnText');
    Elements.progressSection = document.getElementById('progressSection');
    Elements.progressTitle = document.getElementById('progressTitle');
    Elements.progressPercent = document.getElementById('progressPercent');
    Elements.progressFill = document.getElementById('progressFill');
    Elements.progressStatus = document.getElementById('progressStatus');
    Elements.progressProcessed = document.getElementById('progressProcessed');
    Elements.framesDetail = document.getElementById('framesDetail');
    Elements.progressEta = document.getElementById('progressEta');
    Elements.cancelBtn = document.getElementById('cancelBtn');
    Elements.completeSection = document.getElementById('completeSection');
    Elements.completeInfo = document.getElementById('completeInfo');
    Elements.downloadBtn = document.getElementById('downloadBtn');
    Elements.downloadBtnText = document.getElementById('downloadBtnText');
    Elements.newVideoBtn = document.getElementById('newVideoBtn');
    
    // 主题
    Elements.themeToggle = document.getElementById('themeToggle');
    Elements.toastContainer = document.getElementById('toastContainer');
    Elements.loadingOverlay = document.getElementById('loadingOverlay');
    Elements.loadingText = document.getElementById('loadingText');
}

// ==========================================
// 初始化
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    console.log('VideoSR initializing...');
    initElements();
    initTheme();
    initModeSwitch();
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
// 模式切换（视频/图片）
// ==========================================
function initModeSwitch() {
    console.log('Initializing mode switch...');
    
    if (Elements.videoModeBtn) {
        Elements.videoModeBtn.addEventListener('click', function() {
            switchMode('video');
        });
    }
    
    if (Elements.imageModeBtn) {
        Elements.imageModeBtn.addEventListener('click', function() {
            switchMode('image');
        });
    }
}

function switchMode(mode) {
    console.log('Switching to mode:', mode);
    AppState.mode = mode;
    
    // 更新按钮状态
    if (Elements.videoModeBtn) Elements.videoModeBtn.classList.toggle('active', mode === 'video');
    if (Elements.imageModeBtn) Elements.imageModeBtn.classList.toggle('active', mode === 'image');
    
    // 更新上传区域
    if (mode === 'video') {
        if (Elements.uploadTitle) Elements.uploadTitle.textContent = '拖拽视频到这里';
        if (Elements.uploadFormats) Elements.uploadFormats.textContent = '支持格式: MP4, AVI, MOV, MKV, WebM';
        if (Elements.uploadBtnText) Elements.uploadBtnText.textContent = '选择视频文件';
        if (Elements.heroSubtitle) Elements.heroSubtitle.textContent = '免费、开源、隐私安全 - 在浏览器中直接使用AI增强您的视频画质';
        AppState.settings.format = 'mp4';
    } else {
        if (Elements.uploadTitle) Elements.uploadTitle.textContent = '拖拽图片到这里';
        if (Elements.uploadFormats) Elements.uploadFormats.textContent = '支持格式: JPG, PNG, WebP, BMP, TIFF';
        if (Elements.uploadBtnText) Elements.uploadBtnText.textContent = '选择图片文件';
        if (Elements.heroSubtitle) Elements.heroSubtitle.textContent = '免费、开源、隐私安全 - 在浏览器中直接使用AI增强您的图片画质';
        AppState.settings.format = 'png';
    }
    
    // 重置上传状态
    resetToUpload();
}

// ==========================================
// 文件上传功能
// ==========================================
function initUpload() {
    console.log('Initializing upload...');
    
    // 检查必要的DOM元素
    if (!Elements.fileInput) {
        console.error('fileInput not found!');
        return;
    }
    
    // 点击上传区域
    if (Elements.uploadArea) {
        Elements.uploadArea.addEventListener('click', function(e) {
            if (e.target.closest('.upload-btn') || e.target === Elements.uploadArea || 
                e.target.closest('.upload-content')) {
                Elements.fileInput.click();
            }
        });
    }
    
    // 上传按钮
    if (Elements.uploadBtn) {
        Elements.uploadBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            Elements.fileInput.click();
        });
    }
    
    // 文件选择 - 使用显式的事件绑定
    Elements.fileInput.onchange = function(e) {
        console.log('File input changed:', e.target.files);
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            console.log('File selected:', file.name, file.size, file.type);
            handleFileSelect(file);
        }
    };
    
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
    
    // 移除图片
    if (Elements.removeImage) {
        Elements.removeImage.addEventListener('click', function() {
            resetToUpload();
        });
    }
}

async function handleFileSelect(file) {
    console.log('Handling file select:', file.name, file.size, file.type);
    
    // 验证文件类型
    const isVideo = file.type && file.type.startsWith('video/');
    const isImage = file.type && file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
        showToast('error', '请选择有效的视频或图片文件');
        return;
    }
    
    // 验证模式匹配
    if (AppState.mode === 'video' && !isVideo) {
        showToast('error', '当前为视频模式，请选择视频文件');
        return;
    }
    if (AppState.mode === 'image' && !isImage) {
        showToast('error', '当前为图片模式，请选择图片文件');
        return;
    }
    
    // 验证文件大小 (500MB)
    if (file.size > 500 * 1024 * 1024) {
        showToast('error', '文件大小超过500MB限制');
        return;
    }
    
    AppState.currentFile = file;
    
    // 显示加载状态
    showLoading(AppState.mode === 'video' ? '正在上传视频...' : '正在上传图片...');
    
    try {
        // 上传文件到服务器
        const formData = new FormData();
        formData.append(AppState.mode === 'video' ? 'video' : 'image', file);
        
        console.log('Uploading to:', API_BASE + '/api/upload');
        
        const response = await fetch(API_BASE + '/api/upload', {
            method: 'POST',
            body: formData
        });
        
        console.log('Upload response status:', response.status);
        
        const result = await response.json();
        console.log('Upload result:', result);
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || '上传失败');
        }
        
        hideLoading();
        
        // 显示预览
        showPreview(file, result);
        
        showToast('success', AppState.mode === 'video' ? '视频上传成功！' : '图片上传成功！');
        
    } catch (error) {
        hideLoading();
        console.error('Upload error:', error);
        showToast('error', '上传失败: ' + error.message);
    }
}

function showPreview(file, uploadResult) {
    console.log('Showing preview for mode:', AppState.mode);
    
    // 隐藏上传区域
    if (Elements.uploadArea) {
        Elements.uploadArea.style.display = 'none';
    }
    
    if (AppState.mode === 'video') {
        // 显示视频预览
        if (Elements.videoPreviewSection) {
            Elements.videoPreviewSection.style.display = 'block';
        }
        if (Elements.imagePreviewSection) {
            Elements.imagePreviewSection.style.display = 'none';
        }
        
        // 设置原始视频预览
        if (Elements.originalVideo) {
            const objectUrl = URL.createObjectURL(file);
            Elements.originalVideo.src = objectUrl;
            Elements.originalVideo.load();
        }
        
        // 显示视频信息
        const fileSize = formatFileSize(file.size);
        if (Elements.originalVideoInfo) {
            Elements.originalVideoInfo.innerHTML = `
                <div>文件名: ${file.name}</div>
                <div>文件大小: ${fileSize}</div>
            `;
        }
    } else {
        // 显示图片预览
        if (Elements.imagePreviewSection) {
            Elements.imagePreviewSection.style.display = 'block';
        }
        if (Elements.videoPreviewSection) {
            Elements.videoPreviewSection.style.display = 'none';
        }
        
        // 设置原始图片预览
        if (Elements.originalImage) {
            const objectUrl = URL.createObjectURL(file);
            Elements.originalImage.src = objectUrl;
        }
        
        // 显示图片信息
        const fileSize = formatFileSize(file.size);
        const img = new Image();
        img.onload = function() {
            if (Elements.originalImageInfo) {
                Elements.originalImageInfo.innerHTML = `
                    <div>文件名: ${file.name}</div>
                    <div>文件大小: ${fileSize}</div>
                    <div>尺寸: ${img.width} × ${img.height} 像素</div>
                `;
            }
        };
        img.src = URL.createObjectURL(file);
    }
    
    // 显示设置面板
    if (Elements.settingsPanel) {
        Elements.settingsPanel.style.display = 'block';
    }
    
    // 显示操作区域
    if (Elements.actionSection) {
        Elements.actionSection.style.display = 'block';
    }
    
    // 更新格式选择显示
    updateFormatDisplay();
    
    // 存储上传后的文件路径
    if (uploadResult && uploadResult.filePath) {
        AppState.uploadedFilePath = uploadResult.filePath;
        console.log('Stored file path:', AppState.uploadedFilePath);
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
    if (Elements.originalImage && Elements.originalImage.src) {
        URL.revokeObjectURL(Elements.originalImage.src);
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
    
    // 隐藏预览区域
    if (Elements.videoPreviewSection) {
        Elements.videoPreviewSection.style.display = 'none';
    }
    if (Elements.imagePreviewSection) {
        Elements.imagePreviewSection.style.display = 'none';
    }
    
    // 隐藏设置面板
    if (Elements.settingsPanel) {
        Elements.settingsPanel.style.display = 'none';
    }
    
    // 隐藏操作区域
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
    if (Elements.videoResultPlaceholder) {
        Elements.videoResultPlaceholder.style.display = 'flex';
    }
    
    // 重置结果图片
    if (Elements.resultImageWrapper) {
        Elements.resultImageWrapper.style.display = 'none';
    }
    if (Elements.imageResultPlaceholder) {
        Elements.imageResultPlaceholder.style.display = 'flex';
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
        });
    });
    
    // 设置面板折叠（默认折叠）
    if (Elements.settingsToggle) {
        // 默认折叠设置面板
        Elements.settingsContent.style.display = 'none';
        Elements.settingsToggle.classList.add('collapsed');
        
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

function updateFormatDisplay() {
    if (!Elements.imageFormatGroup || !Elements.videoFormatGroup) return;
    
    if (AppState.mode === 'image') {
        Elements.imageFormatGroup.style.display = 'block';
        Elements.videoFormatGroup.style.display = 'none';
        if (Elements.videoAdvancedSettings) Elements.videoAdvancedSettings.style.display = 'none';
    } else {
        Elements.imageFormatGroup.style.display = 'none';
        Elements.videoFormatGroup.style.display = 'block';
        if (Elements.videoAdvancedSettings) Elements.videoAdvancedSettings.style.display = 'block';
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
    console.log('Starting processing...', AppState.uploadedFilePath);
    
    if (!AppState.uploadedFilePath) {
        showToast('error', '请先上传' + (AppState.mode === 'video' ? '视频' : '图片'));
        return;
    }
    
    if (Elements.startBtn) {
        Elements.startBtn.disabled = true;
        Elements.startBtnText.textContent = '处理中...';
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
        
        const response = await fetch(API_BASE + '/api/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        
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
            Elements.startBtnText.textContent = '开始超分处理';
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
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || '查询任务失败');
            }
            
            const task = result.task;
            console.log('Progress update:', task.status, task.progress + '%');
            
            updateProgress(task);
            
            // 任务完成或失败
            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                clearInterval(AppState.progressInterval);
                AppState.progressInterval = null;
                AppState.isProcessing = false;
                
                console.log('Task finished with status:', task.status);
                
                if (task.status === 'completed') {
                    showCompletion(task);
                } else if (task.status === 'cancelled') {
                    showToast('info', '处理已取消');
                    resetToUpload();
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
    
    // 视频模式显示帧数，图片模式不显示
    if (Elements.framesDetail) {
        if (AppState.mode === 'video' && task.processedFrames !== undefined && task.totalFrames !== undefined) {
            Elements.framesDetail.style.display = 'block';
            if (Elements.progressProcessed) {
                Elements.progressProcessed.textContent = task.processedFrames + ' / ' + task.totalFrames + ' 帧';
            }
        } else {
            Elements.framesDetail.style.display = 'none';
        }
    }
    
    if (task.eta !== undefined) {
        if (Elements.progressEta) {
            Elements.progressEta.textContent = formatDuration(task.eta);
        }
    }
}

function showCompletion(task) {
    console.log('Showing completion', task);
    
    if (Elements.progressSection) {
        Elements.progressSection.style.display = 'none';
    }
    if (Elements.completeSection) {
        Elements.completeSection.style.display = 'block';
    }
    
    const outputPath = task.outputPath || '';
    const fileName = outputPath.split('/').pop().split('\').pop() || 'output';
    const fileUrl = API_BASE + '/outputs/' + fileName;
    
    console.log('Output file:', fileName);
    console.log('File URL:', fileUrl);
    
    if (Elements.completeInfo) {
        let infoHtml = `增强${AppState.mode === 'video' ? '视频' : '图片'}已生成：<strong>${fileName}</strong><br>`;
        infoHtml += `输出分辨率: ${task.outputResolution || '未知'}<br>`;
        infoHtml += `处理时间: ${formatDuration(task.processingTime || 0)}`;
        Elements.completeInfo.innerHTML = infoHtml;
    }
    
    if (AppState.mode === 'video') {
        // 显示结果视频（使用预览URL）
        if (Elements.resultVideo) {
            Elements.resultVideo.src = fileUrl;
            Elements.resultVideo.style.display = 'block';
        }
        if (Elements.videoResultPlaceholder) {
            Elements.videoResultPlaceholder.style.display = 'none';
        }
    } else {
        // 显示结果图片（使用预览URL）
        if (Elements.resultImage) {
            Elements.resultImage.src = fileUrl;
            Elements.resultImage.onload = function() {
                console.log('Result image loaded successfully');
            };
            Elements.resultImage.onerror = function() {
                console.error('Failed to load result image:', fileUrl);
            };
            Elements.resultImageWrapper.style.display = 'block';
        }
        if (Elements.imageResultPlaceholder) {
            Elements.imageResultPlaceholder.style.display = 'none';
        }
    }
    
    AppState.completedTaskId = task.id;
    
    // 更新下载按钮文本
    if (Elements.downloadBtnText) {
        Elements.downloadBtnText.textContent = '下载增强' + (AppState.mode === 'video' ? '视频' : '图片');
    }
    
    if (Elements.startBtn) {
        Elements.startBtn.disabled = false;
        Elements.startBtnText.textContent = '开始超分处理';
    }
    
    showToast('success', (AppState.mode === 'video' ? '视频' : '图片') + '超分处理完成！');
}

function showError(task) {
    console.log('Showing error:', task);
    
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
        Elements.startBtnText.textContent = '开始超分处理';
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
            Elements.startBtnText.textContent = '开始超分处理';
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
        'preprocessing': AppState.mode === 'video' ? '正在预处理视频...' : '正在预处理图片...',
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

console.log('VideoSR app.js loaded');
