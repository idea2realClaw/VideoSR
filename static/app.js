/**
 * VideoSR WebUI - 前端交互逻辑（支持视频+图片）
 * 功能：文件上传、预览、超分处理、进度跟踪、结果下载
 */

// ==========================================
// 后台日志（所有前端事件都打到后台）
// ==========================================
function sendBackendLog(level, message, source) {
    source = source || 'frontend';
    // 用 sendBeacon 或 fetch 异步发送，不阻塞 UI
    try {
        fetch('/api/frontend-log', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({level: level, message: message, source: source}),
            keepalive: true
        }).catch(function(){}); // 静默失败，不影响 UI
    } catch(e) {}
}

// ==========================================
// 心跳检测（每15秒）
// ==========================================
var heartbeatInterval = null;
function startHeartbeat() {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(function() {
        fetch('/api/heartbeat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({time: new Date().toISOString()}),
            keepalive: true
        }).catch(function(){});
    }, 15000);
    console.log('Heartbeat started (15s interval)');
    sendBackendLog('info', 'Heartbeat started', 'system');
}

// ==========================================
// 日志系统
// ==========================================
const Logger = {
    panel: null,
    entries: null,
    isOpen: false,
    
    init() {
        this.panel = document.getElementById('logPanel');
        this.entries = document.getElementById('logEntries');
        
        // 绑定按钮事件
        const logToggleBtn = document.getElementById('logToggleBtn');
        const logCloseBtn = document.getElementById('logCloseBtn');
        const logClearBtn = document.getElementById('logClearBtn');
        
        if (logToggleBtn) {
            logToggleBtn.addEventListener('click', () => {
                console.log('logToggleBtn clicked');
                sendBackendLog('click', 'logToggleBtn clicked', 'button');
                this.toggle();
            });
        }
        if (logCloseBtn) {
            logCloseBtn.addEventListener('click', () => {
                console.log('logCloseBtn clicked');
                sendBackendLog('click', 'logCloseBtn clicked', 'button');
                this.close();
            });
        }
        if (logClearBtn) {
            logClearBtn.addEventListener('click', () => {
                console.log('logClearBtn clicked');
                sendBackendLog('click', 'logClearBtn clicked', 'button');
                this.clear();
            });
        }
        
        // 拦截 console.log/warn/error
        this.interceptConsole();
    },
    
    interceptConsole() {
        const self = this;
        
        // 保存原始 console 方法
        const originalLog = console.log;
        const originalWarn = console.warn;
        const originalError = console.error;
        
        // 重写 console.log
        console.log = function(...args) {
            originalLog.apply(console, args);
            self.addEntry('info', args.join(' '));
        };
        
        // 重写 console.warn
        console.warn = function(...args) {
            originalWarn.apply(console, args);
            self.addEntry('warning', args.join(' '));
        };
        
        // 重写 console.error
        console.error = function(...args) {
            originalError.apply(console, args);
            self.addEntry('error', args.join(' '));
        };
    },
    
    toggle() {
        console.log('Logger.toggle() called, isOpen:', this.isOpen);
        this.isOpen ? this.close() : this.open();
    },
    
    open() {
        console.log('Logger.open() called');
        this.isOpen = true;
        this.panel.classList.add('open');
        document.getElementById('logToggleBtn').classList.add('active');
        this.addEntry('info', '[系统] 日志窗口已打开');
        console.log('Logger.open() done, panel classes:', this.panel.className);
    },
    
    close() {
        console.log('Logger.close() called');
        this.isOpen = false;
        this.panel.classList.remove('open');
        document.getElementById('logToggleBtn').classList.remove('active');
        this.addEntry('info', '[系统] 日志窗口已关闭');
    },
    
    clear() {
        if (this.entries) {
            this.entries.innerHTML = '';
            this.addEntry('info', '[系统] 日志已清空');
        }
    },
    
    addEntry(type, message) {
        if (!this.entries) return;
        
        const entry = document.createElement('div');
        entry.className = `log-entry log-${type}`;
        
        const timestamp = new Date().toLocaleTimeString('zh-CN', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        entry.textContent = `[${timestamp}] ${message}`;
        
        this.entries.appendChild(entry);
        
        // 自动滚动到底部
        const content = document.getElementById('logContent');
        if (content) {
            content.scrollTop = content.scrollHeight;
        }
    },
    
    // 快捷方法
    info(msg) { this.addEntry('info', msg); },
    success(msg) { this.addEntry('success', msg); },
    warn(msg) { this.addEntry('warning', msg); },
    error(msg) { this.addEntry('error', msg); },
    input(msg) { this.addEntry('input', `[输入] ${msg}`); },
    output(msg) { this.addEntry('output', `[输出] ${msg}`); }
};

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
        format: 'mp4',
        keepFps: true,
        keepAudio: true,
        bitrate: 8,
        useNpu: true,
        maxWidth: 1024,
        maxHeight: 1024
    },
    isProcessing: false,
    progressInterval: null,
    originalImageWidth: 0,
    originalImageHeight: 0
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
    Elements.videoAdvancedSettings = document.getElementById('videoAdvancedSettings');
    Elements.advancedToggle = document.getElementById('advancedToggle');
    Elements.advancedContent = document.getElementById('advancedContent');
    Elements.keepFps = document.getElementById('keepFps');
    Elements.keepAudio = document.getElementById('keepAudio');
    Elements.bitrate = document.getElementById('bitrate');
    Elements.maxWidthInput = document.getElementById('maxWidthInput');
    Elements.maxHeightInput = document.getElementById('maxHeightInput');
    
    // 操作区域
    Elements.actionSection = document.getElementById('actionSection');
    Elements.actionPanel = document.getElementById('actionPanel');
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
    try {
        Logger.init();
        console.log('Logger initialized');
    } catch(e) { console.error('Logger.init failed:', e); }
    
    try {
        initElements();
        console.log('Elements initialized');
    } catch(e) { console.error('initElements failed:', e); }
    
    try {
        initTheme();
        console.log('Theme initialized');
    } catch(e) { console.error('initTheme failed:', e); }
    
    try {
        initModeSwitch();
        console.log('ModeSwitch initialized');
    } catch(e) { console.error('initModeSwitch failed:', e); }
    
    try {
        initUpload();
        console.log('Upload initialized');
    } catch(e) { console.error('initUpload failed:', e); }
    
    try {
        initSettings();
        console.log('Settings initialized');
    } catch(e) { console.error('initSettings failed:', e); }
    
    try {
        initActions();
        console.log('Actions initialized');
    } catch(e) { console.error('initActions failed:', e); }
    
    try {
        initNavigation();
        console.log('Navigation initialized');
    } catch(e) { console.error('initNavigation failed:', e); }
    
    // 启动心跳
    startHeartbeat();
    
    Logger.info('VideoSR WebUI 初始化完成');
    console.log('VideoSR initialization complete');
    sendBackendLog('info', 'VideoSR WebUI 初始化完成', 'system');
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
    console.log('initModeSwitch() called');
    
    // 导航栏模式切换按钮（新）
    var navImageBtn = document.getElementById('navImageModeBtn');
    var navVideoBtn = document.getElementById('navVideoModeBtn');
    
    if (navVideoBtn) {
        navVideoBtn.addEventListener('click', function() {
            console.log('Nav video mode button clicked');
            switchMode('video');
            // 移动端点击后关闭菜单
            var switcher = document.querySelector('.nav-mode-switcher');
            if (switcher) switcher.classList.remove('open');
        });
    } else {
        console.error('navVideoModeBtn not found!');
    }
    
    if (navImageBtn) {
        navImageBtn.addEventListener('click', function() {
            console.log('Nav image mode button clicked');
            switchMode('image');
            // 移动端点击后关闭菜单
            var switcher = document.querySelector('.nav-mode-switcher');
            if (switcher) switcher.classList.remove('open');
        });
    } else {
        console.error('navImageModeBtn not found!');
    }
    
    // 汉堡菜单按钮
    var hamburger = document.getElementById('navHamburger');
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            this.classList.toggle('active');
            var switcher = document.querySelector('.nav-mode-switcher');
            if (switcher) {
                switcher.classList.toggle('open');
            }
        });
    }
    
    // 默认切换到图片超分
    switchMode('image');
}

function switchMode(mode) {
    console.log('switchMode() called with mode:', mode);
    sendBackendLog('event', 'switchMode: ' + mode, 'mode-switch');
    Logger.info(`切换模式: ${mode === 'video' ? '视频超分' : '图片超分'}`);
    AppState.mode = mode;
    
    // 更新导航栏按钮状态
    var navImageBtn = document.getElementById('navImageModeBtn');
    var navVideoBtn = document.getElementById('navVideoModeBtn');
    if (navImageBtn) navImageBtn.classList.toggle('active', mode === 'image');
    if (navVideoBtn) navVideoBtn.classList.toggle('active', mode === 'video');
    
    // 更新上传区域
    if (mode === 'video') {
        if (Elements.uploadTitle) Elements.uploadTitle.textContent = '拖拽视频到这里';
        if (Elements.uploadFormats) Elements.uploadFormats.textContent = '支持格式: MP4, AVI, MOV, MKV, WebM';
        if (Elements.uploadBtnText) Elements.uploadBtnText.textContent = '选择视频文件';
        if (Elements.heroSubtitle) Elements.heroSubtitle.textContent = '免费、开源、隐私安全 - 在浏览器中直接使用AI增强您的视频画质';
        AppState.settings.format = 'mp4';
        Logger.input('模式: 视频超分, 格式: MP4');
    } else {
        if (Elements.uploadTitle) Elements.uploadTitle.textContent = '拖拽图片到这里';
        if (Elements.uploadFormats) Elements.uploadFormats.textContent = '支持格式: JPG, PNG, WebP, BMP, TIFF';
        if (Elements.uploadBtnText) Elements.uploadBtnText.textContent = '选择图片文件';
        if (Elements.heroSubtitle) Elements.heroSubtitle.textContent = '免费、开源、隐私安全 - 在浏览器中直接使用AI增强您的图片画质';
        AppState.settings.format = 'jpg';
        Logger.input('模式: 图片超分, 格式: JPG');
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
    Logger.input(`选择文件: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB, ${file.type})`);
    
    // 验证文件类型
    const isVideo = file.type && file.type.startsWith('video/');
    const isImage = file.type && file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
        Logger.error('文件类型无效: ' + file.type);
        showToast('error', '请选择有效的视频或图片文件');
        return;
    }
    
    // 验证模式匹配
    if (AppState.mode === 'video' && !isVideo) {
        Logger.error('模式不匹配: 当前为视频模式，但选择了图片文件');
        showToast('error', '当前为视频模式，请选择视频文件');
        return;
    }
    if (AppState.mode === 'image' && !isImage) {
        Logger.error('模式不匹配: 当前为图片模式，但选择了视频文件');
        showToast('error', '当前为图片模式，请选择图片文件');
        return;
    }
    
    // 验证文件大小 (500MB)
    if (file.size > 500 * 1024 * 1024) {
        Logger.error(`文件过大: ${(file.size / 1024 / 1024).toFixed(2)} MB > 500 MB`);
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
        
        Logger.info(`开始上传到服务器: ${API_BASE}/api/upload`);
        
        const response = await fetch(API_BASE + '/api/upload', {
            method: 'POST',
            body: formData
        });
        
        Logger.info(`服务器响应: HTTP ${response.status}`);
        
        const result = await response.json();
        Logger.output(`上传结果: ${JSON.stringify(result).substring(0, 200)}`);
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || '上传失败');
        }
        
        AppState.uploadedFilePath = result.filePath;
        Logger.success(`文件上传成功: ${result.filePath}`);
        
        hideLoading();
        
        // 显示预览
        showPreview(file, result);
        
        showToast('success', AppState.mode === 'video' ? '视频上传成功！' : '图片上传成功！');
        
    } catch (error) {
        hideLoading();
        Logger.error(`上传失败: ${error.message}`);
        showToast('error', '上传失败: ' + error.message);
    }
}

function showPreview(file, uploadResult) {
    console.log('Showing preview for mode:', AppState.mode);
    sendBackendLog('event', 'showPreview: ' + AppState.mode, 'preview');
    
    // 隐藏上传区域
    if (Elements.uploadArea) {
        Elements.uploadArea.style.display = 'none';
    }
    
    if (AppState.mode === 'video') {
        // 显示视频预览（对比滑块布局：原始视频左侧，增强视频右侧）
        if (Elements.videoPreviewSection) {
            Elements.videoPreviewSection.style.display = 'block';
        }
        if (Elements.imagePreviewSection) {
            Elements.imagePreviewSection.style.display = 'none';
        }
        
        // 设置原始视频和结果视频（处理完成前都显示原始视频）
        var origVideo = document.getElementById('originalVideo');
        var resultVideo = document.getElementById('resultVideo');
        if (origVideo) {
            // 释放旧的 blob URL
            if (origVideo.src && origVideo.src.indexOf('blob:') === 0) {
                URL.revokeObjectURL(origVideo.src);
            }
            if (resultVideo && resultVideo.src && resultVideo.src.indexOf('blob:') === 0) {
                URL.revokeObjectURL(resultVideo.src);
            }
            var objectUrl = URL.createObjectURL(file);
            origVideo.src = objectUrl;
            origVideo.load();
            // 结果视频（底层）也先显示原视频，整个区域都是原始视频
            if (resultVideo) {
                resultVideo.src = objectUrl;
                resultVideo.load();
            }
        }
        
        // 初始化视频对比滑块
        initVideoCompareSlider();
        
        // 绑定统一播放控制（两个视频同步播放）
        setupVideoCompareControls();
        
        // 显示视频信息
        var fileSize = formatFileSize(file.size);
        var origInfo = document.getElementById('originalVideoInfo');
        if (origInfo) {
            origInfo.innerHTML = '<div>文件名: ' + file.name + '</div><div>文件大小: ' + fileSize + '</div>';
        }
        var resultInfo = document.getElementById('resultVideoInfo');
        if (resultInfo) {
            resultInfo.innerHTML = '<div>增强后 - 等待处理完成...</div>';
        }
    } else {
        // 显示图片预览（Upscayl 风格对比滑块）
        if (Elements.imagePreviewSection) {
            Elements.imagePreviewSection.style.display = 'block';
        }
        if (Elements.videoPreviewSection) {
            Elements.videoPreviewSection.style.display = 'none';
        }
        
        // 设置原始图片（用 background-image，结果图也用同样方式保证对齐）
        var origBg = document.getElementById('originalImageBg');
        if (origBg) {
            var objectUrl = URL.createObjectURL(file);
            // 释放旧的 background-image URL
            var oldUrl = origBg.style.backgroundImage;
            if (oldUrl && oldUrl.indexOf('blob:') >= 0) {
                var match = oldUrl.match(/url\("?(blob:[^"]+)"?\)/);
                if (match) URL.revokeObjectURL(match[1]);
            }
            origBg.style.backgroundImage = 'url("' + objectUrl + '")';
            console.log('[ORIG] 原图 background-image 已设置:', objectUrl);
        }

        // 超分前：结果图底层（原图下面的 View）也先临时放原图，
        // 让对比区在超分前整片都显示原图；超分完成后会被增强图替换。
        // 注意：必须用独立的 blob URL，不能与 origBg 共用，否则
        // showCompletion 里 revoke 旧结果 URL 时会误删原图 URL。
        var resultDiv = document.getElementById('imageCompareResult');
        if (resultDiv) {
            // 释放上一次残留的结果图临时 URL
            var oldR = resultDiv.style.backgroundImage;
            var rMatch = oldR.match(/url\("?(blob:[^"]+)"?\)/);
            if (rMatch) URL.revokeObjectURL(rMatch[1]);
            var resultTempUrl = URL.createObjectURL(file);
            resultDiv.style.backgroundImage = 'url("' + resultTempUrl + '")';
            console.log('[ORIG] 结果图底层临时放原图:', resultTempUrl);
        }
        
        // 根据图片宽高比设置对比容器的高度（宽度固定 720px）
        var container = document.getElementById('imageCompareContainer');
        var fileSize = formatFileSize(file.size);
        var img = new Image();
        img.onload = function() {
            // 显示原图信息
            var origInfo = document.getElementById('originalImageInfo');
            var infoHtml = '<div>文件名: ' + file.name + '</div>'
                + '<div>文件大小: ' + fileSize + '</div>'
                + '<div>尺寸: ' + img.width + ' × ' + img.height + ' 像素</div>';
            // 记录原图尺寸（供「开始超分」时判断是否跳过）
            AppState.originalImageWidth = img.width;
            AppState.originalImageHeight = img.height;
            var maxW = AppState.settings.maxWidth || 1024;
            var maxH = AppState.settings.maxHeight || 1024;
            var tooLarge = (img.width > maxW && img.height > maxH);
            if (tooLarge) {
                infoHtml += '<div class="image-too-large-warn">⚠️ 宽高均超过 ' + maxW + '×' + maxH + '，已足够清晰，可能不需要超分</div>';
            }
            if (origInfo) origInfo.innerHTML = infoHtml;
            // 设置容器高度（按图片宽高比）
            if (container && img.width > 0) {
                var viewH = Math.round(720 * img.height / img.width);
                container.style.height = viewH + 'px';
                console.log('[ORIG] 对比容器高度设为:', viewH, '(原图:', img.width, 'x', img.height, ')');
            }
            sendBackendLog('info', '[ORIG] 原图:' + img.width + 'x' + img.height, 'preview');
            // toast 提示改为在点击「开始超分」时触发（见 startProcessing），此处不再弹
        };
        img.src = URL.createObjectURL(file);
        
        // 初始化滑块位置（50%，左侧原图，右侧留白等结果）
        var originalDiv = document.getElementById('imageCompareOriginal');
        if (originalDiv) {
            originalDiv.style.clipPath = 'inset(0 50% 0 0)';
        }
    }
    
    // 显示设置面板
    if (Elements.settingsPanel) {
        Elements.settingsPanel.style.display = 'block';
    }
    
    // 显示操作面板（右侧）
    if (Elements.actionPanel) {
        Elements.actionPanel.style.display = 'flex';
    }
    
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
    if (Elements.resultVideo && Elements.resultVideo.src) {
        if (Elements.resultVideo.src.indexOf('blob:') === 0) {
            URL.revokeObjectURL(Elements.resultVideo.src);
        }
    }
    if (Elements.originalImage && Elements.originalImage.src) {
        URL.revokeObjectURL(Elements.originalImage.src);
    }
    
    // 重置状态
    AppState.currentFile = null;
    AppState.currentTaskId = null;
    AppState.uploadedFilePath = null;
    AppState.completedTaskId = null;
    AppState.originalImageWidth = 0;
    AppState.originalImageHeight = 0;
    
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
    
    // 移除对比模式（视频和图片）
    var imageContainer = document.getElementById('imageCompareContainer');
    if (imageContainer) imageContainer.classList.remove('comparing');
    
    // 隐藏设置面板
    if (Elements.settingsPanel) {
        Elements.settingsPanel.style.display = 'none';
    }
    
    // 隐藏操作面板（右侧）
    if (Elements.actionPanel) {
        Elements.actionPanel.style.display = 'none';
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
    
    // 重置结果视频面板
    if (Elements.resultVideo) {
        Elements.resultVideo.pause();
        Elements.resultVideo.removeAttribute('src');
        Elements.resultVideo.load();
    }
    
    // 重置结果图片
    if (Elements.resultImageWrapper) {
        Elements.resultImageWrapper.style.display = 'none';
    }
    if (Elements.imageResultPlaceholder) {
        Elements.imageResultPlaceholder.style.display = 'flex';
    }
    
    // 清理原图和结果图的 background-image（Upscayl 风格对比视图）
    var origBg = document.getElementById('originalImageBg');
    if (origBg) {
        var oldUrl = origBg.style.backgroundImage;
        var blobMatch = oldUrl.match(/url\("?(blob:[^"]+)"?\)/);
        if (blobMatch) URL.revokeObjectURL(blobMatch[1]);
        origBg.style.backgroundImage = '';
    }
    var resultDiv = document.getElementById('imageCompareResult');
    if (resultDiv) {
        var oldUrl2 = resultDiv.style.backgroundImage;
        var blobMatch2 = oldUrl2.match(/url\("?(blob:[^"]+)"?\)/);
        if (blobMatch2) URL.revokeObjectURL(blobMatch2[1]);
        resultDiv.style.backgroundImage = '';
    }
    // 重置滑块和 clip-path
    var originalDiv = document.getElementById('imageCompareOriginal');
    if (originalDiv) originalDiv.style.clipPath = 'inset(0 50% 0 0)';
    var container = document.getElementById('imageCompareContainer');
    if (container) container.style.height = '';
    // 重置图片信息
    var origInfo = document.getElementById('originalImageInfo');
    if (origInfo) origInfo.innerHTML = '';
    var resultInfo = document.getElementById('resultImageInfo');
    if (resultInfo) resultInfo.innerHTML = '';
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
    
    // 原图最大尺寸输入
    if (Elements.maxWidthInput) {
        Elements.maxWidthInput.addEventListener('input', function() {
            var val = parseInt(Elements.maxWidthInput.value) || 0;
            AppState.settings.maxWidth = val;
        });
    }
    if (Elements.maxHeightInput) {
        Elements.maxHeightInput.addEventListener('input', function() {
            var val = parseInt(Elements.maxHeightInput.value) || 0;
            AppState.settings.maxHeight = val;
        });
    }
    
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

// ==========================================
// 操作功能
// ==========================================
function initActions() {
    console.log('Initializing actions...');
    sendBackendLog('info', 'initActions() called', 'system');
    
    if (Elements.startBtn) {
        Elements.startBtn.addEventListener('click', function() {
            console.log('startBtn clicked');
            sendBackendLog('click', 'startBtn clicked', 'button');
            startProcessing();
        });
    }
    
    if (Elements.cancelBtn) {
        Elements.cancelBtn.addEventListener('click', function() {
            console.log('cancelBtn clicked');
            sendBackendLog('click', 'cancelBtn clicked', 'button');
            cancelProcessing();
        });
    }
    
    if (Elements.downloadBtn) {
        Elements.downloadBtn.addEventListener('click', function() {
            console.log('downloadBtn clicked');
            sendBackendLog('click', 'downloadBtn clicked', 'button');
            downloadResult();
        });
    }
    
    if (Elements.newVideoBtn) {
        Elements.newVideoBtn.addEventListener('click', function() {
            console.log('newVideoBtn clicked');
            sendBackendLog('click', 'newVideoBtn clicked', 'button');
            resetToUpload();
        });
    }
}

async function startProcessing() {
    Logger.info(`开始处理: ${AppState.mode === 'video' ? '视频' : '图片'}超分`);
    Logger.input(`输入文件: ${AppState.uploadedFilePath}`);
    Logger.input(`处理设置: 放大${AppState.settings.scale}x, NPU=${AppState.settings.useNpu ? '开启' : '关闭'}, 原图最大=${AppState.settings.maxWidth||1024}x${AppState.settings.maxHeight||1024}`);
    
    if (!AppState.uploadedFilePath) {
        Logger.error('未上传文件');
        showToast('error', '请先上传' + (AppState.mode === 'video' ? '视频' : '图片'));
        return;
    }
    
    var _maxW = AppState.settings.maxWidth || 1024;
    var _maxH = AppState.settings.maxHeight || 1024;
    // 图片模式：宽高均超过设置的最大尺寸时，提示已足够清晰，不执行超分
    if (AppState.mode === 'image'
        && AppState.originalImageWidth > _maxW
        && AppState.originalImageHeight > _maxH) {
        Logger.warn('原图宽高均超过 ' + _maxW + 'x' + _maxH + '，跳过超分: ' + AppState.originalImageWidth + 'x' + AppState.originalImageHeight);
        showToast('warning', '图像尺寸 ' + AppState.originalImageWidth + ' × ' + AppState.originalImageHeight + ' 宽高均超过 ' + _maxW + '×' + _maxH + '，已足够清晰，可能不需要超分');
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
        
        Logger.info(`发送处理请求: ${API_BASE}/api/process`);
        Logger.output(`请求体: ${JSON.stringify(requestBody).substring(0, 200)}`);
        
        const response = await fetch(API_BASE + '/api/process', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });
        
        const result = await response.json();
        Logger.output(`处理响应: ${JSON.stringify(result).substring(0, 200)}`);
        
        if (!response.ok || !result.success) {
            throw new Error(result.message || '启动处理失败');
        }
        
        AppState.currentTaskId = result.taskId;
        AppState.isProcessing = true;
        
        Logger.success(`任务已创建: ${result.taskId}`);
        
        // 开始轮询进度
        startProgressPolling();
        
    } catch (error) {
        Logger.error(`启动处理失败: ${error.message}`);
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
    Logger.info('开始轮询任务进度...');
    
    if (AppState.progressInterval) {
        clearInterval(AppState.progressInterval);
    }
    // 重置日志去重标记（避免跨任务沿用旧的状态/进度）
    AppState._lastLogStatus = null;
    AppState._lastLogProgress = null;
    
    AppState.progressInterval = setInterval(async function() {
        if (!AppState.currentTaskId) return;
        
        try {
            const response = await fetch(API_BASE + '/api/task/' + AppState.currentTaskId);
            const result = await response.json();
            
            if (!response.ok || !result.success) {
                throw new Error(result.message || '查询任务失败');
            }
            
            const task = result.task;
            // 仅在状态或进度真正变化时才打印，避免相同值反复刷屏
            if (AppState._lastLogStatus !== task.status || AppState._lastLogProgress !== task.progress) {
                var pf = '';
                if (task.processedFrames !== undefined) {
                    if (task.type === 'image') {
                        pf = 'Tile ' + (task.processedFrames || 0) + '/' + (task.totalFrames || '?') + ', ';
                    } else {
                        pf = task.processedFrames + '/' + (task.totalFrames || '?') + ' 帧, ';
                    }
                }
                Logger.info(`进度更新: ${pf}${task.status}, ${task.progress}%`);
                AppState._lastLogStatus = task.status;
                AppState._lastLogProgress = task.progress;
            }
            
            updateProgress(task);
            
            // 任务完成或失败
            if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
                clearInterval(AppState.progressInterval);
                AppState.progressInterval = null;
                AppState.isProcessing = false;
                
                Logger.info(`任务结束: ${task.status}`);
                
                if (task.status === 'completed') {
                    Logger.success(`处理完成: 输出文件=${task.outputPath}, 分辨率=${task.outputResolution}, 耗时=${task.processingTime}秒`);
                    if (task.diagnosticInfo) {
                        Logger.info(task.diagnosticInfo);
                    }
                    showCompletion(task);
                } else if (task.status === 'cancelled') {
                    Logger.warn('任务已取消');
                    showToast('info', '处理已取消');
                    resetToUpload();
                } else {
                    Logger.error(`处理失败: ${task.error || '未知错误'}`);
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
    
    // 显示 Tile/帧进度
    if (Elements.framesDetail) {
        if (task.processedFrames !== undefined && task.totalFrames !== undefined) {
            Elements.framesDetail.style.display = 'block';
            if (Elements.progressProcessed) {
                var unit = (task.type === 'image') ? ' Tile' : ' 帧';
                Elements.progressProcessed.textContent = task.processedFrames + ' / ' + task.totalFrames + unit;
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
    sendBackendLog('event', 'showCompletion: ' + (AppState.mode === 'video' ? 'video' : 'image'), 'completion');
    
    if (Elements.progressSection) {
        Elements.progressSection.style.display = 'none';
    }
    if (Elements.completeSection) {
        Elements.completeSection.style.display = 'block';
    }
    
    const outputPath = task.outputPath || '';
    const fileName = outputPath.split('/').pop().split('\\').pop() || 'output';
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
        // 切换增强后视频源（底层/右侧显示增强视频，对比滑块自动生效）
        var resultVideo = document.getElementById('resultVideo');
        var rvInfo = document.getElementById('resultVideoInfo');

        if (resultVideo) {
            resultVideo.src = fileUrl;
            resultVideo.load();

            // 增强视频加载完成后更新容器高度和信息
            resultVideo.onloadeddata = function() {
                var dur = resultVideo.duration || 0;
                if (rvInfo && dur > 0) {
                    rvInfo.innerHTML += '<div>时长: ' + Math.floor(dur) + ' 秒</div>';
                }
                // 根据增强视频的宽高比更新对比容器高度
                var container = document.getElementById('videoCompareContainer');
                if (container && resultVideo.videoWidth > 0) {
                    var aspect = resultVideo.videoHeight / resultVideo.videoWidth;
                    container.style.height = Math.round(720 * aspect) + 'px';
                }
            };
        }
        if (rvInfo) {
            rvInfo.innerHTML = '<div>文件: ' + fileName + '</div>'
                + '<div>分辨率: ' + (task.outputResolution || '未知') + '</div>'
                + '<div>处理时间: ' + formatDuration(task.processingTime || 0) + '</div>';
        }

        // 如果原视频之前播放完毕则重置位置（避免一个在头一个在尾）
        var origVideo = document.getElementById('originalVideo');
        if (origVideo && origVideo.paused && (origVideo.ended || origVideo.currentTime >= origVideo.duration - 0.1)) {
            origVideo.currentTime = 0;
        }
        if (resultVideo && resultVideo.paused && (resultVideo.ended || resultVideo.currentTime >= resultVideo.duration - 0.1)) {
            resultVideo.currentTime = 0;
        }
    } else {
        // 显示结果图片（Upscayl 风格：重叠对比滑块）
        var resultDiv = document.getElementById('imageCompareResult');
        var container = document.getElementById('imageCompareContainer');
        
        if (resultDiv && fileUrl) {
            // 释放旧的 background-image blob URL
            var oldUrl = resultDiv.style.backgroundImage;
            var blobMatch = oldUrl.match(/url\("(blob:[^"]+)"\)/);
            if (blobMatch) URL.revokeObjectURL(blobMatch[1]);
            
            console.log('[RESULT] 开始下载结果图:', fileUrl);
            
            // 用 fetch 下载结果图，转成 blob URL 再设置 background-image
            // 和原图用完全相同的渲染方式（background-image），保证对齐
            fetch(fileUrl).then(function(r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.blob();
            }).then(function(blob) {
                var blobUrl = URL.createObjectURL(blob);
                
                // 先加载图片获取尺寸，再设置 background-image
                var tmpImg = new Image();
                tmpImg.onload = function() {
                    var rw = tmpImg.naturalWidth, rh = tmpImg.naturalHeight;
                    console.log('[RESULT] 结果图尺寸:', rw, 'x', rh);
                    
                    // 设置结果图的 background-image（对比滑块区）
                    resultDiv.style.backgroundImage = 'url("' + blobUrl + '")';
                    
                    // 显示结果图片信息
                    var resultInfo = document.getElementById('resultImageInfo');
                    if (resultInfo) {
                        resultInfo.innerHTML = '<div>输出分辨率: ' + (task.outputResolution || rw + ' × ' + rh) + '</div><div>处理时间: ' + formatDuration(task.processingTime || 0) + '</div>';
                    }
                    
                    // 初始化对比滑块（50% 位置）
                    initImageCompareSlider();
                    
                    console.log('[RESULT] 结果图显示完成，滑块已初始化');
                };
                tmpImg.onerror = function() {
                    console.error('[RESULT] 结果图加载失败（blob URL）');
                    resultDiv.style.backgroundImage = 'url("' + fileUrl + '")';
                    initImageCompareSlider();
                };
                tmpImg.src = blobUrl;
            }).catch(function(e) {
                console.error('[RESULT] 结果图下载失败:', e);
                resultDiv.style.backgroundImage = 'url("' + fileUrl + '")';
                initImageCompareSlider();
            });
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

// ==========================================
// 视频播放工具条绑定（开始/结束/进度/时间）
// ==========================================
// ==========================================
// 视频对比滑块：原图左侧/增强图右侧，可拖动分割线
// ==========================================
function initVideoCompareSlider() {
    var container = document.getElementById('videoCompareContainer');
    var slider = document.getElementById('videoCompareSlider');
    var originalDiv = document.getElementById('videoCompareOriginal');
    var origVideo = document.getElementById('originalVideo');

    if (!container || !slider || !originalDiv) {
        console.warn('Video compare slider elements missing');
        return;
    }

    // 等视频元数据加载后设置容器高度
    function setHeightFromVideo(videoEl) {
        if (videoEl && videoEl.videoWidth > 0) {
            var aspect = videoEl.videoHeight / videoEl.videoWidth;
            container.style.height = Math.round(720 * aspect) + 'px';
        }
    }

    if (origVideo) {
        if (origVideo.readyState >= 1) {
            setHeightFromVideo(origVideo);
        } else {
            origVideo.addEventListener('loadedmetadata', function() {
                setHeightFromVideo(origVideo);
            }, {once: true});
        }
    }

    // 设置滑块位置
    function setSliderPosition(clientX) {
        var rect = container.getBoundingClientRect();
        var x = clientX - rect.left;
        x = Math.max(0, Math.min(rect.width, x));
        var pct = (x / rect.width) * 100;
        slider.style.left = pct + '%';
        originalDiv.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    }

    // 初始化居中
    function initCenter() {
        var rect = container.getBoundingClientRect();
        if (rect.width > 0) {
            setSliderPosition(rect.left + rect.width / 2);
        } else {
            requestAnimationFrame(initCenter);
        }
    }
    initCenter();

    // 拖动逻辑
    var isDragging = false;
    var handle = slider.querySelector('.image-compare-slider-handle');

    function onStart(e) {
        isDragging = true;
        e.preventDefault();
    }

    function onMove(e) {
        if (!isDragging) return;
        var cx = e.type.indexOf('touch') === 0 ? e.touches[0].clientX : e.clientX;
        setSliderPosition(cx);
    }

    function onEnd() {
        isDragging = false;
    }

    slider.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);

    slider.addEventListener('touchstart', onStart);
    document.addEventListener('touchmove', onMove);
    document.addEventListener('touchend', onEnd);

    // 点击容器任意位置移动滑块
    container.addEventListener('click', function(e) {
        if (e.target.closest('.image-compare-slider-handle')) return;
        setSliderPosition(e.clientX);
    });
}

// ==========================================
// 同步双视频播放控件（原始视频与增强视频一起播放）
// ==========================================
function setupVideoCompareControls() {
    var playBtn = document.getElementById('videoComparePlay');
    var stopBtn = document.getElementById('videoCompareStop');
    var progress = document.getElementById('videoCompareProgress');
    var filled = document.getElementById('videoCompareProgressFilled');
    var timeLabel = document.getElementById('videoCompareTime');
    var origVideo = document.getElementById('originalVideo');
    var resultVideo = document.getElementById('resultVideo');

    if (!playBtn || !stopBtn || !progress || !filled || !timeLabel || !origVideo || !resultVideo) {
        console.warn('setupVideoCompareControls: elements missing');
        return;
    }

    function fmt(t) {
        if (!isFinite(t) || t < 0) t = 0;
        var m = Math.floor(t / 60);
        var s = Math.floor(t % 60);
        return m + ':' + (s < 10 ? '0' + s : s);
    }

    function updateTime() {
        var cur = origVideo.currentTime || 0;
        var dur = origVideo.duration || 0;
        timeLabel.textContent = fmt(cur) + ' / ' + fmt(dur);
        var pct = dur > 0 ? (cur / dur) * 100 : 0;
        filled.style.width = pct + '%';
    }

    // 仅首次绑定事件，避免重复上传叠加监听器
    if (!playBtn.dataset.bound) {
        playBtn.dataset.bound = '1';

        playBtn.addEventListener('click', function() {
            // 两个视频同步播放
            var p1 = origVideo.play();
            if (p1 && p1.catch) p1.catch(function(){});
            var p2 = resultVideo.play();
            if (p2 && p2.catch) p2.catch(function(){});
        });

        stopBtn.addEventListener('click', function() {
            origVideo.pause();
            resultVideo.pause();
            try { origVideo.currentTime = 0; } catch(e) {}
            try { resultVideo.currentTime = 0; } catch(e) {}
            updateTime();
        });

        progress.addEventListener('click', function(e) {
            var rect = progress.getBoundingClientRect();
            if (rect.width <= 0 || !isFinite(origVideo.duration) || origVideo.duration <= 0) return;
            var ratio = (e.clientX - rect.left) / rect.width;
            ratio = Math.max(0, Math.min(1, ratio));
            var newTime = ratio * origVideo.duration;
            origVideo.currentTime = newTime;
            resultVideo.currentTime = newTime;
        });

        origVideo.addEventListener('timeupdate', updateTime);
        origVideo.addEventListener('loadedmetadata', updateTime);
        origVideo.addEventListener('play', updateTime);
        origVideo.addEventListener('pause', updateTime);
        origVideo.addEventListener('ended', function() {
            resultVideo.pause();
            try { resultVideo.currentTime = origVideo.currentTime; } catch(e) {}
            updateTime();
        });
    }

    // 重置进度条与时间显示
    filled.style.width = '0%';
    timeLabel.textContent = '0:00 / 0:00';
}

// ==========================================
// ==========================================
// 图片精确对齐函数（替代 object-fit: contain）
// 用 JS 精确计算每张图的显示尺寸和 margin
// 确保原图和结果图使用完全相同的公式，像素级对齐

// 对比滑动条功能
// ==========================================
var compareSliders = {};

function initCompareSlider(type) {
    // type: 'image' or 'video'
    // 新逻辑：原图在上层，超分图在下层，完全重叠
    // 滑块右側的上层变透明（clip-path 裁剪），露出下层
    var container = document.getElementById(type + 'CompareContainer');
    var slider = document.getElementById(type + 'CompareSlider');
    var originalDiv = container ? container.querySelector('.compare-original') : null;
    var resultDiv = document.getElementById(type + 'CompareResult');

    if (!container || !slider || !originalDiv) {
        console.warn('Compare slider elements not found for type:', type);
        return;
    }

    // 激活对比模式：添加 class，确保结果图显示
    container.classList.add('comparing');
    if (resultDiv) resultDiv.style.display = 'block';

    // 等待容器渲染完成后再计算宽度
    function setSliderToCenter() {
        var rect = container.getBoundingClientRect();
        var containerWidth = rect.width;
        if (containerWidth === 0) {
            requestAnimationFrame(setSliderToCenter);
            return;
        }
        var centerX = containerWidth / 2;
        slider.style.left = centerX + 'px';
        // 用 clip-path 裁切原图右側（右侧透明）
        originalDiv.style.clipPath = 'inset(0 ' + (containerWidth - centerX) + 'px 0 0)';
        console.log('Compare slider initialized:', type, 'width:', containerWidth);
    }

    requestAnimationFrame(setSliderToCenter);

    // 如果已经初始化过，不再重复绑定
    if (compareSliders[type]) return;

    compareSliders[type] = true;

    var isDragging = false;

    function onDragStart(e) {
        isDragging = true;
        e.preventDefault();
        sendBackendLog('event', 'compare drag start: ' + type, 'compare');
    }

    function onDragMove(e) {
        if (!isDragging) return;
        var clientX;
        if (e.touches) {
            clientX = e.touches[0].clientX;
        } else {
            clientX = e.clientX;
        }

        var rect = container.getBoundingClientRect();
        var x = clientX - rect.left;
        x = Math.max(20, Math.min(x, rect.width - 20));

        slider.style.left = x + 'px';
        // 裁切原图：右侧 (rect.width - x) 的部分变透明
        originalDiv.style.clipPath = 'inset(0 ' + (rect.width - x) + 'px 0 0)';
    }

    function onDragEnd() {
        isDragging = false;
    }

    // 鼠标事件
    slider.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);

    // 触摸事件
    slider.addEventListener('touchstart', onDragStart, {passive: false});
    document.addEventListener('touchmove', onDragMove, {passive: false});
    document.addEventListener('touchend', onDragEnd);

    console.log('Compare slider initialized for:', type);
    sendBackendLog('info', 'Compare slider initialized: ' + type, 'compare');
}

// ==========================================
// Upscayl 风格图片对比滑块（重叠对比）
// ==========================================
var imageCompareInitialized = false;

function initImageCompareSlider() {
    var container = document.getElementById('imageCompareContainer');
    var slider = document.getElementById('imageCompareSlider');
    var originalDiv = document.getElementById('imageCompareOriginal');
    
    if (!container || !slider || !originalDiv) {
        console.warn('[COMPARE] 初始化失败：元素未找到');
        return;
    }
    
    // 设置滑块到中间
    function setSliderToCenter() {
        var rect = container.getBoundingClientRect();
        var w = rect.width;
        if (w === 0) {
            requestAnimationFrame(setSliderToCenter);
            return;
        }
        var centerX = w / 2;
        slider.style.left = centerX + 'px';
        // clip-path：只显示左侧 50%
        originalDiv.style.clipPath = 'inset(0 ' + (w - centerX) + 'px 0 0)';
        console.log('[COMPARE] 滑块初始化完成，容器宽度:', w);
    }
    
    requestAnimationFrame(setSliderToCenter);
    
    // 如果已经初始化过，不再重复绑定
    if (imageCompareInitialized) return;
    imageCompareInitialized = true;
    
    var isDragging = false;
    
    function onDragStart(e) {
        isDragging = true;
        e.preventDefault();
        slider.style.cursor = 'grabbing';
    }
    
    function onDragMove(e) {
        if (!isDragging) return;
        var clientX = e.touches ? e.touches[0].clientX : e.clientX;
        var rect = container.getBoundingClientRect();
        var x = clientX - rect.left;
        // 限制滑块范围（20px ~ 容器宽度-20px）
        x = Math.max(20, Math.min(x, rect.width - 20));
        
        slider.style.left = x + 'px';
        // 更新 clip-path：左侧显示原图，右侧显示结果图
        originalDiv.style.clipPath = 'inset(0 ' + (rect.width - x) + 'px 0 0)';
    }
    
    function onDragEnd() {
        isDragging = false;
        slider.style.cursor = 'grab';
    }
    
    // 鼠标事件（绑定在 slider 上）
    slider.addEventListener('mousedown', onDragStart);
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
    
    // 触摸事件
    slider.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove', onDragMove, { passive: false });
    document.addEventListener('touchend', onDragEnd);
    
    // 点击容器也可以移动滑块
    container.addEventListener('click', function(e) {
        var rect = container.getBoundingClientRect();
        var x = e.clientX - rect.left;
        x = Math.max(20, Math.min(x, rect.width - 20));
        slider.style.left = x + 'px';
        originalDiv.style.clipPath = 'inset(0 ' + (rect.width - x) + 'px 0 0)';
    });
    
    console.log('[COMPARE] Upscayl 风格对比滑块已初始化');
}
