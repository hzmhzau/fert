/**
 * 科学施肥推荐系统 - 客户端应用
 * @version 1.0.0
 * @description 基于GIS和土壤养分数据库的智能施肥推荐系统
 */

// ==================== 全局变量 ====================
const AppState = {
    isServerOnline: false,
    currentDataMode: 'online',
    useCustomSoilData: false,
    userLocation: null,
    lastCalculation: null,
    map: null,
    marker: null
};

// 城市坐标映射
const CITY_COORDS = {
    "南京": { lon: 118.763, lat: 32.057 },
    "武汉": { lon: 114.305, lat: 30.592 },
    "长沙": { lon: 112.938, lat: 28.228 },
    "南昌": { lon: 115.858, lat: 28.676 },
    "杭州": { lon: 120.153, lat: 30.267 },
    "上海": { lon: 121.473, lat: 31.230 },
    "合肥": { lon: 117.283, lat: 31.861 }
};

// 养分水平样式映射
const NUTRIENT_LEVEL_STYLES = {
    "极低": "nutrient-low",
    "低": "nutrient-low",
    "中等": "nutrient-medium",
    "高": "nutrient-high",
    "极高": "nutrient-very-high",
    "默认值": "nutrient-default",
    "离线数据": "nutrient-default",
    "手动输入": "nutrient-default"
};

// API配置
const API = {
    BASE_URL: window.location.origin,
    ENDPOINTS: {
        HEALTH: '/health',
        CALCULATE: '/calculate',
        TEST_GEOTIFF: '/test_geotiff',
        API_TEST: '/api/test',
        WEATHER: '/api/weather',
        FERTILIZER_TIMING: '/api/fertilizer_timing'
    },
    TIMEOUT: 30000 // 30秒超时
};

// ==================== 地理定位管理器 ====================
class GeoLocationManager {
    constructor() {
        this.currentLocation = null;
    }

    /**
     * 获取用户位置（优先级：GPS → 网络定位 → 默认位置）
     */
    async getUserLocation() {
        console.log('🌍 开始获取用户位置...');
        
        if (this.currentLocation) {
            console.log('✓ 使用缓存位置');
            return this.currentLocation;
        }

        // 方法1: 尝试 GPS 定位
        const gpsLocation = await this.requestGPSLocation();
        if (gpsLocation) {
            this.currentLocation = gpsLocation;
            console.log('✓ GPS 定位成功');
            return gpsLocation;
        }

        // 方法2: 尝试网络定位
        const networkLocation = await this.requestNetworkLocation();
        if (networkLocation) {
            this.currentLocation = networkLocation;
            console.log('✓ 网络定位成功');
            return networkLocation;
        }

        // 方法3: 返回默认位置
        const defaultLocation = { lon: 118.763, lat: 32.057, source: '默认位置(南京)' };
        this.currentLocation = defaultLocation;
        console.log('⚠️ 使用默认位置');
        return defaultLocation;
    }

    /**
     * 请求 GPS 定位
     */
    requestGPSLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('⚠️ 浏览器不支持 GPS 定位');
                resolve(null);
                return;
            }

            const timeoutId = setTimeout(() => {
                console.warn('⚠️ GPS 定位超时');
                resolve(null);
            }, 10000);

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    clearTimeout(timeoutId);
                    const { latitude, longitude } = position.coords;
                    resolve({ 
                        lon: longitude, 
                        lat: latitude, 
                        source: 'GPS 定位'
                    });
                },
                (error) => {
                    clearTimeout(timeoutId);
                    console.warn('⚠️ GPS 定位失败');
                    resolve(null);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }

    /**
     * 请求网络定位（高德地图IP定位）
     */
    requestNetworkLocation() {
        return new Promise((resolve) => {
            if (typeof AMap === 'undefined') {
                console.warn('⚠️ AMap 未加载');
                resolve(null);
                return;
            }

            try {
                AMap.plugin('AMap.Geolocation', () => {
                    const geolocation = new AMap.Geolocation({
                        enableHighAccuracy: true,
                        timeout: 10000,
                        noCache: true
                    });

                    geolocation.getCurrentPosition((status, result) => {
                        if (status === 'complete' && result.position) {
                            const { lng, lat } = result.position;
                            resolve({ 
                                lon: lng, 
                                lat: lat, 
                                source: '网络定位'
                            });
                        } else {
                            console.warn('⚠️ 网络定位失败');
                            resolve(null);
                        }
                    });
                });
            } catch (error) {
                console.warn('⚠️ 网络定位异常');
                resolve(null);
            }
        });
    }
}

// ==================== 地图管理器 ====================
class MapManager {
    constructor() {
        this.map = null;
        this.marker = null;
        this.geocoder = null;
    }

    /**
     * 初始化地图（异步，支持自动定位）
     * @param {number} lon - 经度（可选）
     * @param {number} lat - 纬度（可选）
     */
    async initMap(lon = null, lat = null) {
        console.log('========== 地图初始化开始 ==========');
        
        // 如果没有有效的坐标，自动定位
        if (lon === null || lat === null || isNaN(lon) || isNaN(lat)) {
            console.log('🌍 未提供坐标，开始自动定位...');
            const locationManager = new GeoLocationManager();
            const location = await locationManager.getUserLocation();
            lon = location.lon;
            lat = location.lat;
            console.log('✓ 定位完成:', { lon, lat, source: location.source });
        }
        
        console.log('目标坐标:', { lon, lat });
        console.log('AMap 是否存在:', typeof AMap !== 'undefined');
        
        // 检查AMap是否加载
        if (typeof AMap === 'undefined') {
            console.error('❌ 高德地图API未加载 - AMap 对象不存在');
            console.error('可能原因:');
            console.error('1. API Key 无效或过期');
            console.error('2. 网络连接问题');
            console.error('3. 脚本加载失败');
            this.showMapError('❌ 高德地图API未加载,请检查网络连接和API Key配置');
            return;
        }

        // 检查容器是否存在
        const container = document.getElementById('mapContainer');
        if (!container) {
            console.error('❌ 地图容器不存在');
            this.showMapError('地图容器不存在');
            return;
        }

        console.log('✓ 容器存在，尺寸:', {
            width: container.offsetWidth,
            height: container.offsetHeight
        });

        if (container.offsetHeight === 0) {
            console.warn('⚠️ 容器高度为0，地图无法显示');
        }

        try {
            // 创建地图实例
            console.log('正在创建地图实例...');
            this.map = new AMap.Map('mapContainer', {
                center: [lon, lat],
                zoom: 12,
                resizeEnable: true
            });
            
            console.log('✓ 地图实例创建成功');
            console.log('✓ 地图缩放级别:', this.map.getZoom());
            console.log('✓ 地图中心:', this.map.getCenter());

            // 使用AMap.plugin异步加载插件
            console.log('正在加载地图插件...');
            AMap.plugin(['AMap.ToolBar', 'AMap.Scale', 'AMap.Geocoder'], () => {
                try {
                    this.map.addControl(new AMap.ToolBar());
                    this.map.addControl(new AMap.Scale());
                    this.geocoder = new AMap.Geocoder();
                    console.log('✓ 地图插件加载成功');
                } catch (pluginError) {
                    console.warn('⚠️ 地图插件加载失败:', pluginError);
                }
            });

            // 添加地图点击事件
            this.map.on('click', (e) => {
                console.log('地图被点击，坐标:', e.lnglat);
                this.updateMarker(e.lnglat.getLng(), e.lnglat.getLat());
            });

            // 初始标记
            this.updateMarker(lon, lat, false);

            console.log('========== 地图初始化完成 ==========');
        } catch (error) {
            console.error('❌ 地图初始化失败:', error);
            console.error('错误详情:', error.message, error.stack);
            this.showMapError('地图初始化失败: ' + error.message);
        }
    }

    /**
     * 更新标记位置
     */
    updateMarker(lon, lat, updateInputs = true) {
        // 验证坐标
        const validation = Utils.validateCoordinates(lon, lat);

        if (!this.map) {
            console.warn('地图未初始化');
            return;
        }

        // 移除旧标记
        if (this.marker) {
            this.map.remove(this.marker);
        }

        // 创建新标记
        this.marker = new AMap.Marker({
            position: [lon, lat],
            title: validation.valid ? '选中位置' : '坐标超出范围',
            icon: validation.valid ?
                'https://webapi.amap.com/theme/v1.3/markers/n/mark_r.png' :
                'https://webapi.amap.com/theme/v1.3/markers/n/mark_b.png'
        });

        this.map.add(this.marker);
        this.map.setCenter([lon, lat]);

        // 更新输入框
        if (updateInputs) {
            const elements = new DOMElements();
            elements.lonInput.value = lon.toFixed(4);
            elements.latInput.value = lat.toFixed(4);

            // 更新位置信息
            new LocationManager(elements).updateLocationInfo();
        }

        // 显示位置信息
        this.showLocationInfo(lon, lat, validation.valid);

        // 获取地址信息
        if (this.geocoder && validation.valid) {
            try {
                this.geocoder.getAddress([lon, lat], (status, result) => {
                    if (status === 'complete' && result.info === 'OK') {
                        const address = result.regeocode.formattedAddress;
                        this.updateLocationDisplay(lon, lat, address);
                    }
                });
            } catch (geocoderError) {
                console.warn('地理编码失败:', geocoderError);
            }
        }
    }

    /**
     * 显示位置信息
     */
    showLocationInfo(lon, lat, isValid) {
        const infoBox = document.getElementById('mapLocationInfo');
        const infoText = document.getElementById('mapLocationText');

        if (!infoBox || !infoText) return;

        const closestCity = Utils.findNearestCity(lon, lat);
        let html = `<strong>经度:</strong> ${lon.toFixed(4)}°, <strong>纬度:</strong> ${lat.toFixed(4)}°`;

        if (closestCity) {
            html += ` | <strong>最近城市:</strong> ${closestCity}`;
        }

        if (!isValid) {
            html += ' <span class="badge bg-warning">⚠️ 坐标超出服务范围</span>';
        }

        infoText.innerHTML = html;
        infoBox.style.display = 'block';
    }

    /**
     * 更新位置显示(含地址)
     */
    updateLocationDisplay(lon, lat, address) {
        const infoText = document.getElementById('mapLocationText');
        if (!infoText) return;

        const closestCity = Utils.findNearestCity(lon, lat);
        let html = `<strong>经度:</strong> ${lon.toFixed(4)}°, <strong>纬度:</strong> ${lat.toFixed(4)}°`;

        if (closestCity) {
            html += ` | <strong>最近城市:</strong> ${closestCity}`;
        }

        if (address) {
            html += `<br><strong>地址:</strong> ${address}`;
        }

        infoText.innerHTML = html;
    }

    /**
     * 显示地图错误
     */
    showMapError(message) {
        const container = document.getElementById('mapContainer');
        if (container) {
            container.innerHTML = `
                <div class="d-flex align-items-center justify-content-center h-100 bg-light">
                    <div class="text-center p-4">
                        <i class="fas fa-exclamation-triangle text-warning fs-1 mb-3"></i>
                        <p class="text-muted">${message}</p>
                        <button class="btn btn-sm btn-outline-primary" onclick="location.reload()">
                            <i class="fas fa-redo me-1"></i>重新加载
                        </button>
                    </div>
                </div>
            `;
        }
    }

    /**
     * 销毁地图
     */
    destroy() {
        if (this.map) {
            this.map.destroy();
            this.map = null;
            this.marker = null;
        }
    }
}

// ==================== DOM元素引用 ====================
class DOMElements {
    constructor() {
        // 表单元素
        this.form = document.getElementById('fertilizerForm');
        this.yieldInput = document.getElementById('yieldInput');
        this.dateInput = document.getElementById('dateInput');
        this.lonInput = document.getElementById('lonInput');
        this.latInput = document.getElementById('latInput');

        // 土壤输入
        this.customSoilToggle = document.getElementById('customSoilToggle');
        this.soilInputs = document.getElementById('soilInputs');
        this.soilNInput = document.getElementById('soilNInput');
        this.soilPInput = document.getElementById('soilPInput');
        this.soilKInput = document.getElementById('soilKInput');

        // 位置控制
        this.getLocationBtn = document.getElementById('getLocationBtn');
        this.locationStatus = document.getElementById('locationStatus');
        this.selectCityBtn = document.getElementById('selectCityBtn');
        this.citySelect = document.getElementById('citySelect');
        this.locationInfo = document.getElementById('locationInfo');
        this.locationText = document.getElementById('locationText');

        // 加载和结果
        this.loadingSpinner = document.getElementById('loadingSpinner');
        this.loadingText = document.getElementById('loadingText');
        this.resultSection = document.getElementById('resultSection');

        // 按钮
        this.resetBtn = document.getElementById('resetBtn');
        this.printBtn = document.getElementById('printBtn');
        this.saveDataBtn = document.getElementById('saveDataBtn');
        this.exportBtn = document.getElementById('exportBtn');
        this.testDataBtn = document.getElementById('testDataBtn');

        // 状态指示器
        this.serverStatus = document.getElementById('serverStatus');
        this.offlineAlert = document.getElementById('offlineAlert');

        // 导航链接
        this.aboutLink = document.getElementById('aboutLink');
        this.techLink = document.getElementById('techLink');
        this.contactLink = document.getElementById('contactLink');
    }
}

// ==================== 工具函数 ====================
const Utils = {
    /**
     * 显示加载状态
     */
    showLoading(message = '正在处理,请稍候...') {
        const elements = new DOMElements();
        elements.loadingSpinner.style.display = 'block';
        elements.loadingText.textContent = message;
        elements.resultSection.style.display = 'none';
    },
    
    /**
     * 隐藏加载状态
     */
    hideLoading() {
        const elements = new DOMElements();
        elements.loadingSpinner.style.display = 'none';
    },
    
    /**
     * 显示通知
     */
    showNotification(message, type = 'info', duration = 3000) {
        const alert = document.createElement('div');
        alert.className = `alert alert-${type} position-fixed top-0 start-50 translate-middle-x mt-3`;
        alert.style.zIndex = '9999';
        alert.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : type === 'danger' ? 'exclamation-circle' : 'info-circle'} me-2"></i>
            ${message}
        `;
        
        document.body.appendChild(alert);
        
        setTimeout(() => {
            alert.style.opacity = '0';
            setTimeout(() => alert.remove(), 300);
        }, duration);
    },
    
    /**
     * 格式化数字
     */
    formatNumber(num, decimals = 1) {
        return parseFloat(num).toFixed(decimals);
    },
    
    /**
     * 验证经纬度
     */
    validateCoordinates(lon, lat) {
        const lonNum = parseFloat(lon);
        const latNum = parseFloat(lat);
        
        if (isNaN(lonNum) || isNaN(latNum)) {
            return { valid: false, message: '经纬度必须是数字' };
        }
        
        if (lonNum < 110 || lonNum > 122) {
            return { valid: false, message: '经度必须在110-122之间' };
        }
        
        if (latNum < 28 || latNum > 33) {
            return { valid: false, message: '纬度必须在28-33之间' };
        }
        
        return { valid: true, lon: lonNum, lat: latNum };
    },
    
    /**
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    /**
     * 获取最近的城市
     */
    findNearestCity(lon, lat) {
        let closestCity = null;
        let minDistance = Infinity;
        
        for (const [city, coords] of Object.entries(CITY_COORDS)) {
            const distance = Math.sqrt(
                Math.pow(lon - coords.lon, 2) + 
                Math.pow(lat - coords.lat, 2)
            );
            if (distance < minDistance) {
                minDistance = distance;
                closestCity = city;
            }
        }
        
        return closestCity;
    }
};

// ==================== API服务 ====================
const APIService = {
    /**
     * 健康检查
     */
    async checkHealth() {
        try {
            const response = await fetch(API.ENDPOINTS.HEALTH, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            return await response.json();
        } catch (error) {
            console.warn('健康检查失败:', error.message);
            throw error;
        }
    },
    
    /**
     * 计算施肥方案
     */
    async calculate(data) {
        try {
            const response = await fetch(API.ENDPOINTS.CALCULATE, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(API.TIMEOUT)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage;
                try {
                    const errorData = JSON.parse(errorText);
                    errorMessage = errorData.error || `服务器错误: ${response.status}`;
                } catch {
                    errorMessage = `HTTP ${response.status}: ${errorText.substring(0, 100)}`;
                }
                throw new Error(errorMessage);
            }
            
            const result = await response.json();
            if (result.error) throw new Error(result.error);
            
            return result;
        } catch (error) {
            console.error('API调用失败:', error);
            throw error;
        }
    },
    
    /**
     * 测试土壤数据
     */
    async testSoilData(lon, lat) {
        try {
            const response = await fetch(`${API.ENDPOINTS.TEST_GEOTIFF}?lon=${lon}&lat=${lat}`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(10000)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            return await response.json();
        } catch (error) {
            console.error('土壤数据测试失败:', error);
            throw error;
        }
    },
    
    /**
     * 获取施肥时机建议（含天气）
     */
    async getFertilizerTiming(data) {
        try {
            const response = await fetch(API.ENDPOINTS.FERTILIZER_TIMING, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(15000)
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            return await response.json();
        } catch (error) {
            console.warn('获取施肥时机建议失败:', error.message);
            return null;
        }
    }
};

// ==================== 服务器状态管理 ====================
class ServerStatusManager {
    constructor(elements) {
        this.elements = elements;
    }
    
    async check() {
        this.updateUI('checking', '检查服务器连接...');
        
        try {
            const data = await APIService.checkHealth();
            AppState.isServerOnline = true;
            AppState.currentDataMode = 'online';
            this.updateUI('online', '服务器在线');
            this.hideOfflineAlert();
            console.log('服务器状态:', data);
        } catch (error) {
            AppState.isServerOnline = false;
            AppState.currentDataMode = 'offline';
            this.updateUI('offline', '服务器离线');
            console.warn('服务器连接失败:', error.message);
            
            setTimeout(() => this.showOfflineAlert(), 1000);
        }
    }
    
    updateUI(status, message) {
        const icons = {
            online: '<i class="fas fa-check-circle me-2"></i>',
            offline: '<i class="fas fa-times-circle me-2"></i>',
            checking: '<i class="fas fa-spinner fa-spin me-2"></i>'
        };
        
        this.elements.serverStatus.className = `server-status status-${status}`;
        this.elements.serverStatus.innerHTML = `${icons[status]}${message}`;
    }
    
    showOfflineAlert() {
        this.elements.offlineAlert.style.display = 'block';
        setTimeout(() => {
            this.elements.offlineAlert.style.opacity = '1';
        }, 10);
    }
    
    hideOfflineAlert() {
        this.elements.offlineAlert.style.opacity = '0';
        setTimeout(() => {
            this.elements.offlineAlert.style.display = 'none';
        }, 300);
    }
}

// ==================== 位置管理 ====================
class LocationManager {
    constructor(elements) {
        this.elements = elements;
    }
    
    async getCurrentLocation() {
        this.elements.getLocationBtn.disabled = true;
        this.updateStatus('loading', '正在获取位置...');
        
        if (!navigator.geolocation) {
            this.updateStatus('error', '浏览器不支持地理定位功能');
            this.elements.getLocationBtn.disabled = false;
            return;
        }
        
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        };
        
        navigator.geolocation.getCurrentPosition(
            (position) => this.handleSuccess(position),
            (error) => this.handleError(error),
            options
        );
    }
    
    handleSuccess(position) {
        const { longitude: lon, latitude: lat, accuracy } = position.coords;

        const validation = Utils.validateCoordinates(lon, lat);

        if (validation.valid) {
            this.elements.lonInput.value = lon.toFixed(4);
            this.elements.latInput.value = lat.toFixed(4);

            AppState.userLocation = { lon, lat, accuracy };

            // 更新地图
            if (AppState.map) {
                AppState.map.updateMarker(lon, lat, false);
            }

            this.updateStatus('success', `位置获取成功! 精度: ${Math.round(accuracy)}米`);
            this.updateLocationInfo();

            setTimeout(() => this.clearStatus(), 3000);
        } else {
            this.updateStatus('error', '当前位置不在长江中下游地区');

            setTimeout(() => {
                const useNearest = confirm(
                    `您的位置(经度 ${lon.toFixed(4)}°, 纬度 ${lat.toFixed(4)}°)不在系统覆盖范围(经度110-122°, 纬度28-33°)。\n\n是否使用最近的城市坐标?`
                );

                if (useNearest) {
                    const nearestCity = Utils.findNearestCity(lon, lat);
                    if (nearestCity) {
                        this.setCity(nearestCity);
                        this.updateStatus('success', `已使用最近城市: ${nearestCity}`);
                    }
                }
            }, 500);
        }

        this.elements.getLocationBtn.disabled = false;
    }
    
    handleError(error) {
        const errorMessages = {
            [error.PERMISSION_DENIED]: '用户拒绝了位置请求',
            [error.POSITION_UNAVAILABLE]: '位置信息不可用',
            [error.TIMEOUT]: '请求位置超时'
        };
        
        const message = errorMessages[error.code] || '未知错误';
        this.updateStatus('error', `获取位置失败: ${message}`);
        this.elements.getLocationBtn.disabled = false;
        
        setTimeout(() => {
            if (confirm(`${message}\n\n是否手动选择城市?`)) {
                this.elements.selectCityBtn.click();
            }
        }, 1000);
    }
    
    updateStatus(type, message) {
        const icons = {
            loading: '<i class="fas fa-spinner fa-spin me-1"></i>',
            success: '<i class="fas fa-check-circle me-1"></i>',
            error: '<i class="fas fa-exclamation-circle me-1"></i>'
        };
        
        this.elements.locationStatus.className = `location-status location-${type}`;
        this.elements.locationStatus.innerHTML = `${icons[type]}${message}`;
    }
    
    clearStatus() {
        this.elements.locationStatus.innerHTML = '';
    }
    
    setCity(cityName) {
        const coords = CITY_COORDS[cityName];
        if (coords) {
            this.elements.lonInput.value = coords.lon;
            this.elements.latInput.value = coords.lat;

            // 更新地图
            if (AppState.map) {
                AppState.map.updateMarker(coords.lon, coords.lat, false);
            }

            this.updateLocationInfo();
        }
    }
    
    updateLocationInfo() {
        const lon = parseFloat(this.elements.lonInput.value);
        const lat = parseFloat(this.elements.latInput.value);
        
        if (isNaN(lon) || isNaN(lat)) return;
        
        const closestCity = Utils.findNearestCity(lon, lat);
        
        let text = `当前坐标: 经度 ${lon.toFixed(4)}°, 纬度 ${lat.toFixed(4)}°`;
        if (closestCity) {
            text += `, 最近城市: ${closestCity}`;
        }
        
        if (AppState.userLocation && 
            Math.abs(AppState.userLocation.lon - lon) < 0.001 && 
            Math.abs(AppState.userLocation.lat - lat) < 0.001) {
            text += ' <span class="badge bg-success">浏览器定位</span>';
        }
        
        this.elements.locationText.innerHTML = text;
        this.elements.locationInfo.style.display = 'block';
    }
}

// ==================== 表单验证和提交 ====================
class FormHandler {
    constructor(elements) {
        this.elements = elements;
    }
    
    validate() {
        const cropType = document.querySelector('input[name="crop"]:checked')?.value;
        const targetYield = this.elements.yieldInput.value;
        const sowingDate = this.elements.dateInput.value;
        const lon = this.elements.lonInput.value;
        const lat = this.elements.latInput.value;
        
        if (!cropType) {
            Utils.showNotification('请选择作物类型', 'danger');
            return false;
        }
        
        if (!targetYield || targetYield < 100 || targetYield > 1000) {
            Utils.showNotification('请输入100-1000之间的产量值', 'danger');
            this.elements.yieldInput.focus();
            return false;
        }
        
        // 允许不选择播期：如果未选择播期但填写了经纬度，则可从农时表获取推荐播期
        if (!sowingDate) {
            const lonVal = this.elements.lonInput.value;
            const latVal = this.elements.latInput.value;
            if (!lonVal || !latVal) {
                Utils.showNotification('请选择播种日期或填写经纬度以自动获取推荐播期', 'danger');
                this.elements.dateInput.focus();
                return false;
            }
        }
        
        const validation = Utils.validateCoordinates(lon, lat);
        if (!validation.valid) {
            Utils.showNotification(validation.message, 'danger');
            this.elements.lonInput.focus();
            return false;
        }
        
        // 验证自定义土壤数据
        if (AppState.useCustomSoilData) {
            const soilN = this.elements.soilNInput.value;
            const soilP = this.elements.soilPInput.value;
            const soilK = this.elements.soilKInput.value;
            
            if (soilN && (parseFloat(soilN) < 0 || parseFloat(soilN) > 300)) {
                Utils.showNotification('碱解氮(N)值必须在0-300之间', 'danger');
                return false;
            }
            
            if (soilP && (parseFloat(soilP) < 0 || parseFloat(soilP) > 100)) {
                Utils.showNotification('有效磷(P)值必须在0-100之间', 'danger');
                return false;
            }
            
            if (soilK && (parseFloat(soilK) < 0 || parseFloat(soilK) > 500)) {
                Utils.showNotification('有效钾(K)值必须在0-500之间', 'danger');
                return false;
            }
        }
        
        return true;
    }
    
    collectData() {
        const data = {
            crop: document.querySelector('input[name="crop"]:checked').value,
            yield: parseFloat(this.elements.yieldInput.value),
            date: this.elements.dateInput.value,
            lon: parseFloat(this.elements.lonInput.value),
            lat: parseFloat(this.elements.latInput.value)
        };
        
        if (AppState.useCustomSoilData) {
            const customSoil = {};
            
            if (this.elements.soilNInput.value) {
                customSoil.N = parseFloat(this.elements.soilNInput.value);
            }
            if (this.elements.soilPInput.value) {
                customSoil.P = parseFloat(this.elements.soilPInput.value);
            }
            if (this.elements.soilKInput.value) {
                customSoil.K = parseFloat(this.elements.soilKInput.value);
            }
            
            if (Object.keys(customSoil).length > 0) {
                data.custom_soil_data = customSoil;
                data.use_custom_soil = true;
            }
        }
        
        return data;
    }
    
    async submit() {
        if (!this.validate()) return;
        
        const data = this.collectData();
        
        Utils.showLoading(
            AppState.isServerOnline 
                ? '正在获取土壤数据并计算施肥方案,请稍候...' 
                : '服务器离线,正在使用模拟数据计算...'
        );
        
        try {
            let result;
            
            if (AppState.isServerOnline) {
                result = await APIService.calculate(data);
                AppState.currentDataMode = 'online';
            } else {
                // 离线模式 - 生成模拟数据
                result = this.generateOfflineData(data);
                AppState.currentDataMode = 'offline';
                new ServerStatusManager(this.elements).showOfflineAlert();
            }
            
            AppState.lastCalculation = { data, result };
            new ResultRenderer(this.elements).render(result, data);
            
            Utils.showNotification('施肥方案计算完成!', 'success');
        } catch (error) {
            console.error('计算失败:', error);
            Utils.hideLoading();
            
            const useOffline = confirm(`计算失败: ${error.message}\n\n是否使用离线模拟数据进行计算?`);
            
            if (useOffline) {
                const offlineResult = this.generateOfflineData(data);
                AppState.currentDataMode = 'offline';
                AppState.lastCalculation = { data, result: offlineResult };
                new ResultRenderer(this.elements).render(offlineResult, data);
                new ServerStatusManager(this.elements).showOfflineAlert();
            }
        } finally {
            Utils.hideLoading();
        }
    }
    
    generateOfflineData(data) {
        // 生成模拟的土壤数据
        const simulatedSoil = {
            N: Math.random() * 30 + 70,
            P: Math.random() * 15 + 15,
            K: Math.random() * 50 + 80
        };
        
        // 如果有自定义数据,使用自定义数据
        if (data.custom_soil_data) {
            if (data.custom_soil_data.N) simulatedSoil.N = data.custom_soil_data.N;
            if (data.custom_soil_data.P) simulatedSoil.P = data.custom_soil_data.P;
            if (data.custom_soil_data.K) simulatedSoil.K = data.custom_soil_data.K;
        }
        
        // 生成施肥方案
        const fertilizerUsage = data.crop === '水稻' ? {
            "尿素_基肥": Utils.formatNumber(data.yield * 0.012),
            "尿素_分蘖肥": Utils.formatNumber(data.yield * 0.006),
            "尿素_穗肥": Utils.formatNumber(data.yield * 0.006),
            "过磷酸钙_基肥": Utils.formatNumber(data.yield * 0.002),
            "氯化钾_基肥": Utils.formatNumber(data.yield * 0.004)
        } : {
            "配方肥_基肥": Utils.formatNumber(data.yield * 0.1),
            "尿素_拔节肥": Utils.formatNumber(data.yield * 0.03),
            "过磷酸钙_基肥": Utils.formatNumber(data.yield * 0.025),
            "氯化钾_基肥": Utils.formatNumber(data.yield * 0.02)
        };
        
        return {
            fertilizer_usage: fertilizerUsage,
            stage_advice: {
                "基肥": "播种前整地时深施",
                "追肥": data.crop === '水稻' ? "分蘖期和穗期追施" : "拔节期和孕穗期追施"
            },
            guidance: [
                `1. ${data.crop === '水稻' ? '基肥占总氮肥的50%左右' : '基肥占总氮肥的60%左右'},磷钾肥全部作基肥`,
                "2. 注意分期施肥,提高肥料利用率",
                "3. 结合土壤养分状况调整施肥量",
                "4. (离线模式) 建议在连接网络后重新计算获取精确数据"
            ],
            calc_params: {
                target_yield: data.yield,
                nutrient_demand: [
                    Utils.formatNumber(data.yield * 0.022),
                    Utils.formatNumber(data.yield * 0.012),
                    Utils.formatNumber(data.yield * 0.025)
                ],
                soil_supply: [
                    Utils.formatNumber(simulatedSoil.N * 0.15 * 0.3),
                    Utils.formatNumber(simulatedSoil.P * 0.15 * 0.2),
                    Utils.formatNumber(simulatedSoil.K * 0.15 * 0.4)
                ],
                straw_supply: [0, 0, 0],
                soil_nutrients: [
                    Utils.formatNumber(simulatedSoil.N),
                    Utils.formatNumber(simulatedSoil.P),
                    Utils.formatNumber(simulatedSoil.K)
                ],
                nutrient_levels: {
                    AN: this.getNutrientLevel(simulatedSoil.N, 'AN'),
                    AP: this.getNutrientLevel(simulatedSoil.P, 'AP'),
                    AK: this.getNutrientLevel(simulatedSoil.K, 'AK')
                },
                data_source: {
                    AN: data.custom_soil_data?.N ? '手动输入' : '离线模拟数据',
                    AP: data.custom_soil_data?.P ? '手动输入' : '离线模拟数据',
                    AK: data.custom_soil_data?.K ? '手动输入' : '离线模拟数据'
                },
                fertilizer_efficiency: [30, 25, 45],
                is_default_data: true,
                use_custom_soil: data.use_custom_soil || false
            }
        };
    }
    
    getNutrientLevel(value, type) {
        const ranges = {
            'AN': { low: 50, medium: 90, high: 120 },
            'AP': { low: 5, medium: 10, high: 20 },
            'AK': { low: 50, medium: 100, high: 150 }
        };
        
        const range = ranges[type];
        if (value < range.low) return '低';
        if (value < range.medium) return '中等';
        if (value < range.high) return '高';
        return '极高';
    }
}

// ==================== 结果渲染 ====================
class ResultRenderer {
    constructor(elements) {
        this.elements = elements;
    }
    
    render(result, inputData) {
        Utils.hideLoading();
        
        // 更新标题
        document.getElementById('resultTitle').innerHTML = `
            <i class="fas fa-clipboard-check me-2"></i>${inputData.crop}施肥方案推荐
        `;
        
        // 渲染各个部分
        this.renderSoilNutrients(result.calc_params);
        this.renderBasicParams(result, inputData);
        this.renderFertilizerUsage(result.fertilizer_usage);
        this.renderStageAdvice(result.stage_advice);
        this.renderGuidance(result.guidance);
        this.renderNutrientBalance(result);
        
        // 获取并渲染天气信息
        this.renderWeatherInfo(inputData);
        
        // 显示结果区域
        this.elements.resultSection.style.display = 'block';
        this.elements.resultSection.scrollIntoView({ behavior: 'smooth' });
    }
    
    /**
     * 渲染天气信息
     */
    async renderWeatherInfo(inputData) {
        const weatherContainer = document.getElementById('weatherInfo');
        const weatherWarningCard = document.getElementById('weatherWarningCard');
        
        // 显示加载状态
        if (weatherContainer) {
            weatherContainer.innerHTML = `
                <div class="text-center py-3">
                    <div class="spinner-border spinner-border-sm text-primary" role="status">
                        <span class="visually-hidden">加载中...</span>
                    </div>
                    <span class="ms-2 text-muted">正在获取天气信息...</span>
                </div>
            `;
        }
        
        try {
            // 调用施肥时机API
            const timingData = await APIService.getFertilizerTiming({
                crop: inputData.crop,
                sowing_date: inputData.date,
                lon: inputData.lon,
                lat: inputData.lat
            });
            
            if (timingData && timingData.success) {
                console.log('[Weather Debug] timingData.data_source:', timingData.data_source);
                console.log('[Weather Debug] timingData keys:', Object.keys(timingData));
                const weather = timingData.weather || {};
                const growthStage = timingData.growth_stage || {};
                const advice = timingData.timing_advice || {};
                const alerts = weather.alerts || [];
                const warnings = weather.warnings || [];
                
                // 渲染天气预警卡片
                if (weatherWarningCard) {
                    this.renderWeatherWarningCard(weather, growthStage, advice, alerts, warnings, timingData.is_simulated, timingData.data_source);
                }
                
                // 渲染原有的天气信息容器（如果存在）
                if (weatherContainer) {
                    this.renderWeatherContainer(weather, growthStage, advice, timingData.is_simulated, timingData.data_source);
                }
            } else {
                if (weatherContainer) {
                    weatherContainer.innerHTML = `
                        <div class="text-muted text-center py-3">
                            <i class="fas fa-cloud-sun-slash me-2"></i>无法获取天气信息
                        </div>
                    `;
                }
                if (weatherWarningCard) {
                    weatherWarningCard.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('获取天气信息失败:', error);
            if (weatherContainer) {
                weatherContainer.innerHTML = `
                    <div class="text-muted text-center py-3">
                        <i class="fas fa-exclamation-circle me-2"></i>天气信息获取失败
                    </div>
                `;
            }
            if (weatherWarningCard) {
                weatherWarningCard.style.display = 'none';
            }
        }
    }
    
    /**
     * 渲染天气预警卡片
     */
    renderWeatherWarningCard(weather, growthStage, advice, alerts, warnings, isSimulated, dataSource) {
        const weatherWarningCard = document.getElementById('weatherWarningCard');
        const warningSummary = document.getElementById('weatherWarningSummary');
        const currentWeatherInfo = document.getElementById('currentWeatherInfo');
        const forecastWeatherInfo = document.getElementById('forecastWeatherInfo');
        const fertilizerSuitability = document.getElementById('fertilizerSuitability');
        const warningDetails = document.getElementById('weatherWarningDetails');
        const weatherBasedAdvice = document.getElementById('weatherBasedAdvice');
        
        if (!weatherWarningCard) return;
        
        // 判断是否有预警
        const hasWarnings = warnings && warnings.length > 0;
        const warningLevel = weather.warning_level || 'low';
        
        // 根据预警级别设置卡片样式
        if (warningLevel === 'high') {
            weatherWarningCard.className = 'card result-card border-danger';
            weatherWarningCard.querySelector('.card-header').className = 'card-header bg-danger bg-opacity-25';
        } else if (warningLevel === 'medium') {
            weatherWarningCard.className = 'card result-card border-warning';
            weatherWarningCard.querySelector('.card-header').className = 'card-header bg-warning bg-opacity-25';
        } else {
            weatherWarningCard.className = 'card result-card border-success';
            weatherWarningCard.querySelector('.card-header').className = 'card-header bg-success bg-opacity-25';
        }
        
        // 显示卡片
        weatherWarningCard.style.display = 'block';
        
        // 渲染预警摘要
        if (warningSummary) {
            if (hasWarnings) {
                const levelClass = warningLevel === 'high' ? 'danger' : (warningLevel === 'medium' ? 'warning' : 'info');
                warningSummary.innerHTML = `
                    <div class="alert alert-${levelClass} mb-0">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-exclamation-triangle me-2 fs-5"></i>
                            <div>
                                <strong>发现 ${warnings.length} 条天气预警</strong>
                                <div class="small mt-1">请关注以下天气因素对施肥作业的影响</div>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                warningSummary.innerHTML = `
                    <div class="alert alert-success mb-0">
                        <div class="d-flex align-items-center">
                            <i class="fas fa-check-circle me-2 fs-5"></i>
                            <div>
                                <strong>当前天气条件良好</strong>
                                <div class="small mt-1">适宜进行施肥作业</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        }
        
        // 渲染当前天气
        if (currentWeatherInfo) {
            const weatherIcon = this.getWeatherIcon(weather.current_weather);
            currentWeatherInfo.innerHTML = `
                <div class="d-flex align-items-center mb-2">
                    <i class="fas ${weatherIcon} fs-3 me-2 text-warning"></i>
                    <div>
                        <div class="fs-5 fw-bold">${weather.current_weather || '未知'}</div>
                        <div class="text-muted small">${weather.temperature || '--'}°C</div>
                    </div>
                </div>
                <div class="row g-2 small">
                    <div class="col-6">
                        <span class="text-muted">湿度:</span>
                        <span class="fw-bold">${weather.humidity || '--'}%</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted">风力:</span>
                        <span class="fw-bold">${weather.wind_power || '--'}级</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted">降雨风险:</span>
                        <span class="badge ${weather.rain_risk === '高' ? 'bg-danger' : (weather.rain_risk === '中' ? 'bg-warning text-dark' : 'bg-success')}">${weather.rain_risk || '低'}</span>
                    </div>
                    <div class="col-6">
                        <span class="text-muted">温度风险:</span>
                        <span class="badge ${weather.temperature_risk === '高' ? 'bg-danger' : (weather.temperature_risk === '中' ? 'bg-warning text-dark' : 'bg-success')}">${weather.temperature_risk || '低'}</span>
                    </div>
                </div>
            `;
        }
        
        // 渲染未来7天天气预报（横向卡片）
        if (forecastWeatherInfo) {
            const dailyForecast = weather.daily_forecast || [];
            if (dailyForecast.length > 0) {
                const days = dailyForecast.slice(0, 7);
                let forecastHtml = `<div class="row g-2">`;
                days.forEach((day, index) => {
                    const weatherIcon = this.getWeatherIcon(day.dayweather);
                    const isToday = index === 0;
                    const dateLabel = isToday ? '今天' : this.formatDate(day.date);
                    const colClass = days.length >= 7 ? 'col' : 'col-auto';
                    forecastHtml += `
                        <div class="${colClass}">
                            <div class="text-center p-2 rounded ${isToday ? 'bg-primary bg-opacity-10 border border-primary border-opacity-25' : 'bg-white border'}" style="min-width:64px;">
                                <div class="small text-muted mb-1">${dateLabel}</div>
                                <i class="fas ${weatherIcon} text-warning mb-1" style="font-size:1.2rem;"></i>
                                <div class="small text-muted" style="font-size:0.7rem;">${day.dayweather}</div>
                                <div class="mt-1" style="font-size:0.75rem;">
                                    <span class="text-danger fw-bold">${day.daytemp}°</span>
                                    <span class="text-muted">/</span>
                                    <span class="text-primary">${day.nighttemp}°</span>
                                </div>
                                ${day.pop ? `<div class="small text-info mt-1" style="font-size:0.68rem;"><i class="fas fa-tint me-1"></i>${day.pop}%</div>` : ''}
                            </div>
                        </div>
                    `;
                });
                forecastHtml += `</div>`;
                forecastWeatherInfo.innerHTML = forecastHtml;
            } else {
                forecastWeatherInfo.innerHTML = `<div class="small text-muted">暂无预报数据</div>`;
            }
        }

        // 渲染施肥适宜性
        if (fertilizerSuitability) {
            const canFertilize = advice.can_fertilize !== false;
            const suitabilityClass = canFertilize ? 'success' : 'danger';
            const suitabilityIcon = canFertilize ? 'fa-check-circle' : 'fa-times-circle';
            
            fertilizerSuitability.innerHTML = `
                <div class="d-flex align-items-center p-2 bg-${suitabilityClass} bg-opacity-10 rounded">
                    <i class="fas ${suitabilityIcon} text-${suitabilityClass} fs-4 me-2"></i>
                    <div>
                        <div class="fw-bold text-${suitabilityClass}">${canFertilize ? '适合施肥' : '不建议施肥'}</div>
                        <div class="small text-muted">${growthStage.stage || ''} - ${growthStage.description || ''}</div>
                    </div>
                </div>
            `;
        }
        
        // 渲染预警详情
        if (warningDetails && alerts && alerts.length > 0) {
            let alertsHtml = '<div class="mt-3"><h6 class="text-muted mb-2"><i class="fas fa-bell me-1"></i>预警详情</h6>';
            alerts.forEach(alert => {
                const levelClass = alert.level === 'high' ? 'danger' : (alert.level === 'medium' ? 'warning' : 'info');
                alertsHtml += `
                    <div class="alert alert-${levelClass} py-2 px-3 mb-2">
                        <div class="d-flex align-items-start">
                            <i class="fas ${alert.icon} me-2 mt-1"></i>
                            <div>
                                <div class="fw-bold">${alert.title}</div>
                                <div class="small">${alert.message}</div>
                            </div>
                        </div>
                    </div>
                `;
            });
            alertsHtml += '</div>';
            warningDetails.innerHTML = alertsHtml;
        } else if (warningDetails) {
            warningDetails.innerHTML = '';
        }
        
        // 渲染施肥建议
        if (weatherBasedAdvice) {
            let adviceHtml = '';
            
            // 最佳施肥时机
            if (advice.best_timing && advice.best_timing.length > 0) {
                adviceHtml += '<div class="mb-2">';
                advice.best_timing.forEach(item => {
                    adviceHtml += `
                        <div class="p-2 bg-success bg-opacity-10 rounded mb-1">
                            <i class="fas fa-check text-success me-1"></i>${item}
                        </div>
                    `;
                });
                adviceHtml += '</div>';
            }
            
            // 一般建议
            if (advice.general_advice && advice.general_advice.length > 0) {
                adviceHtml += '<div class="small text-muted mt-2">管理建议</div>';
                advice.general_advice.forEach(item => {
                    adviceHtml += `<div class="small text-muted">• ${item}</div>`;
                });
            }
            
            // 天气警告建议
            if (advice.weather_warning) {
                adviceHtml += `
                    <div class="alert alert-warning py-2 px-3 small mt-2 mb-0">
                        <i class="fas fa-exclamation-triangle me-1"></i>${advice.weather_warning}
                    </div>
                `;
            }
            
            // 模拟数据提示
            if (isSimulated) {
                adviceHtml += `
                    <div class="small text-muted mt-2">
                        <i class="fas fa-info-circle me-1"></i>使用模拟天气数据，建议查看当地实际天气预报
                    </div>
                `;
            }

            // 数据来源信息
            const sourceIconMap = {
                '和风天气': 'fa-cloud-sun',
                'Open-Meteo': 'fa-globe',
                '模拟数据': 'fa-flask'
            };
            const sourceIcon = sourceIconMap[dataSource] || 'fa-cloud';
            const sourceLinkMap = {
                '和风天气': 'https://www.qweather.com',
                'Open-Meteo': 'https://open-meteo.com'
            };
            const sourceLink = sourceLinkMap[dataSource];
            const sourceName = dataSource || 'Open-Meteo';
            adviceHtml += `
                <div class="d-flex align-items-center mt-3 pt-2 border-top border-secondary border-opacity-25">
                    <i class="fas ${sourceIcon} text-muted me-1" style="font-size:0.75rem;"></i>
                    <span class="text-muted" style="font-size:0.75rem;">
                        天气数据来源：${sourceLink
                            ? `<a href="${sourceLink}" target="_blank" rel="noopener" class="text-muted text-decoration-none">${sourceName} <i class="fas fa-external-link-alt" style="font-size:0.65rem;"></i></a>`
                            : sourceName}
                    </span>
                </div>
            `;
            
            weatherBasedAdvice.innerHTML = adviceHtml || '<div class="text-muted small">暂无特殊建议</div>';
        }
    }
    
    /**
     * 渲染天气容器（原有功能）
     */
    renderWeatherContainer(weather, growthStage, advice, isSimulated, dataSource) {
        const weatherContainer = document.getElementById('weatherInfo');
        if (!weatherContainer) return;
        
        // 天气图标
        let weatherIcon = this.getWeatherIcon(weather.current_weather);
        
        // 施肥适宜性
        const canFertilize = advice.can_fertilize !== false;
        const suitabilityClass = canFertilize ? 'text-success' : 'text-danger';
        const suitabilityIcon = canFertilize ? 'fa-check-circle' : 'fa-times-circle';
        
        // 构建HTML
        let html = `
            <div class="mb-3">
                <div class="d-flex align-items-center mb-2">
                    <i class="fas ${weatherIcon} fs-4 me-2 text-warning"></i>
                    <span class="fs-5">${weather.current_weather || '未知'}</span>
                    <span class="ms-2 text-muted">${weather.temperature || '--'}°C</span>
                </div>
                <div class="small text-muted">
                    <span class="me-3"><i class="fas fa-tint me-1"></i>降雨风险: ${weather.rain_risk || '低'}</span>
                </div>
            </div>
            
            <div class="mb-3 p-2 bg-light rounded">
                <div class="small text-muted mb-1">当前生长阶段</div>
                <div class="fw-bold">${growthStage.stage || '未知'}</div>
                <div class="small text-muted">${growthStage.description || ''}</div>
            </div>
            
            <div class="mb-3">
                <div class="d-flex align-items-center ${suitabilityClass}">
                    <i class="fas ${suitabilityIcon} me-2"></i>
                    <span class="fw-bold">${canFertilize ? '适合施肥' : '不建议施肥'}</span>
                </div>
            </div>
        `;
        
        // 添加最佳施肥时机
        if (advice.best_timing && advice.best_timing.length > 0) {
            html += `<div class="mb-2"><div class="small text-muted mb-1">最佳施肥时机</div>`;
            advice.best_timing.forEach(item => {
                html += `<div class="p-2 bg-success bg-opacity-10 rounded mb-1 small"><i class="fas fa-check text-success me-1"></i>${item}</div>`;
            });
            html += `</div>`;
        }
        
        // 添加天气警告
        if (weather.warning) {
            html += `
                <div class="alert alert-warning py-2 px-3 small mb-2">
                    <i class="fas fa-exclamation-triangle me-1"></i>${weather.warning}
                </div>
            `;
        }
        
        // 添加一般建议
        if (advice.general_advice && advice.general_advice.length > 0) {
            html += `<div class="small text-muted mt-2">管理建议</div>`;
            advice.general_advice.forEach(item => {
                html += `<div class="small text-muted">• ${item}</div>`;
            });
        }
        
        // 如果是模拟数据，添加提示
        if (isSimulated) {
            html += `<div class="small text-muted mt-2"><i class="fas fa-info-circle me-1"></i>使用模拟天气数据</div>`;
        }
        
        weatherContainer.innerHTML = html;
    }
    
    /**
     * 获取天气图标
     */
    getWeatherIcon(weather) {
        if (!weather) return 'fa-sun';
        if (weather.includes('暴雨')) return 'fa-cloud-showers-heavy';
        if (weather.includes('大雨')) return 'fa-cloud-rain';
        if (weather.includes('中雨')) return 'fa-cloud-rain';
        if (weather.includes('小雨')) return 'fa-cloud-rain';
        if (weather.includes('雨')) return 'fa-cloud-rain';
        if (weather.includes('雪')) return 'fa-snowflake';
        if (weather.includes('阴')) return 'fa-cloud';
        if (weather.includes('多云')) return 'fa-cloud-sun';
        if (weather.includes('晴')) return 'fa-sun';
        return 'fa-cloud-sun';
    }
    
    /**
     * 格式化日期显示
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const weekDay = weekDays[date.getDay()];
        return `${month}/${day} ${weekDay}`;
    }
    
    renderSoilNutrients(calcParams) {
        const [N, P, K] = calcParams.soil_nutrients;
        const levels = calcParams.nutrient_levels;
        const sources = calcParams.data_source;
        
        document.getElementById('soilNValue').textContent = Utils.formatNumber(N);
        document.getElementById('soilPValue').textContent = Utils.formatNumber(P);
        document.getElementById('soilKValue').textContent = Utils.formatNumber(K);
        
        this.updateNutrientBadge('soilNLevel', levels.AN);
        this.updateNutrientBadge('soilPLevel', levels.AP);
        this.updateNutrientBadge('soilKLevel', levels.AK);
        
        const sourceText = Object.values(sources).join(', ');
        document.getElementById('dataSourceText').textContent = sourceText;
        
        const isDefault = calcParams.is_default_data;
        const useCustom = calcParams.use_custom_soil;
        const statusEl = document.getElementById('soilDataStatus');
        const infoEl = document.getElementById('soilInputSourceInfo');
        
        if (useCustom) {
            statusEl.innerHTML = '<span class="text-info"><i class="fas fa-edit me-1"></i>使用手动输入的土壤数据</span>';
            infoEl.innerHTML = '<span class="text-info"><i class="fas fa-info-circle me-1"></i>部分或全部土壤养分值来自手动输入</span>';
        } else if (AppState.currentDataMode === 'offline' || isDefault) {
            statusEl.innerHTML = '<span class="text-warning"><i class="fas fa-exclamation-circle me-1"></i>使用模拟数据,建议连接网络获取真实土壤数据</span>';
            infoEl.innerHTML = '';
        } else {
            statusEl.innerHTML = '<span class="text-success"><i class="fas fa-check-circle me-1"></i>成功从数据库获取土壤数据</span>';
            infoEl.innerHTML = '';
        }
    }
    
    updateNutrientBadge(elementId, level) {
        const element = document.getElementById(elementId);
        element.textContent = level;
        element.className = 'nutrient-badge';
        
        const styleClass = NUTRIENT_LEVEL_STYLES[level] || 'nutrient-default';
        element.classList.add(styleClass);
    }
    
    renderBasicParams(result, inputData) {
        const efficiency = result.calc_params.fertilizer_efficiency;
        const isDefault = result.calc_params.is_default_data;
        const useCustom = result.calc_params.use_custom_soil;
        
        let html = `
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">目标产量</span>
                <span>${result.calc_params.target_yield} 公斤/亩</span>
            </div>
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">用户输入播种日期</span>
                <span>${inputData.date || '未提供'}</span>
            </div>
        `;
        
        // 显示播期推荐区间和播期类型判断
        if (result.calc_params.recommended_sowing_date_start && result.calc_params.recommended_sowing_date_end) {
            const recommendStart = result.calc_params.recommended_sowing_date_start;
            const recommendEnd = result.calc_params.recommended_sowing_date_end;
            let sowingType = '正常播期';
            let typeClass = 'text-success';
            
            // 判断播期类型
            if (inputData.date) {
                const inputDate = new Date(inputData.date);
                const startDate = new Date(recommendStart);
                const endDate = new Date(recommendEnd);
                
                if (inputDate < startDate) {
                    sowingType = '早播';
                    typeClass = 'text-warning';
                } else if (inputDate > endDate) {
                    sowingType = '迟播';
                    typeClass = 'text-danger';
                } else {
                    sowingType = '正常播期';
                    typeClass = 'text-success';
                }
            }
            
            html += `
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">最佳播种时间</span>
                <span>${recommendStart} 至 ${recommendEnd}</span>
            </div>
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">您的播期类型</span>
                <span class="${typeClass} fw-bold">${sowingType}</span>
            </div>
            `;
        } else if (result.calc_params.recommended_sowing_date) {
            html += `
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">推荐播期（农时表）</span>
                <span>${result.calc_params.recommended_sowing_date}</span>
            </div>
            `;
        }
        
        html += `
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">地理位置</span>
                <span>经度 ${inputData.lon}°, 纬度 ${inputData.lat}°</span>
            </div>
            <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                <span class="fw-bold">肥料利用率</span>
                <span>N:${efficiency[0]}% P:${efficiency[1]}% K:${efficiency[2]}%</span>
            </div>
        `;
        
        if (useCustom) {
            html += '<div class="alert alert-info mt-2 p-2 small mb-0"><i class="fas fa-edit me-1"></i>使用了手动输入的土壤养分数据</div>';
        } else if (AppState.currentDataMode === 'offline' || isDefault) {
            html += '<div class="alert alert-warning mt-2 p-2 small mb-0">⚠️ 当前使用模拟数据,连接网络后可获取更精确的土壤数据和计算结果</div>';
        }
        
        document.getElementById('basicParams').innerHTML = html;
    }
    
    renderFertilizerUsage(usage) {
        let html = '';
        for (const [key, value] of Object.entries(usage)) {
            html += `
                <div class="d-flex justify-content-between mb-3 p-2 bg-white rounded">
                    <span class="fw-bold">${key}</span>
                    <span class="text-primary fw-bold">${value} 公斤/亩</span>
                </div>
            `;
        }
        document.getElementById('fertilizerUsage').innerHTML = html;
    }
    
    renderStageAdvice(advice) {
        let html = '';
        for (const [key, value] of Object.entries(advice)) {
            html += `
                <div class="mb-3 p-3 bg-white rounded">
                    <h6 class="fw-bold text-primary mb-2">
                        <i class="fas fa-clock me-1"></i>${key}
                    </h6>
                    <p class="mb-0">${value}</p>
                </div>
            `;
        }
        document.getElementById('stageAdvice').innerHTML = html;
    }
    
    renderGuidance(guidance) {
        let html = '<ul class="list-unstyled">';
        if (guidance && Array.isArray(guidance)) {
            guidance.forEach(item => {
                html += `
                    <li class="mb-2 p-2 bg-white rounded">
                        <i class="fas fa-check-circle text-success me-2"></i>${item}
                    </li>
                `;
            });
        } else {
            html += '<li class="p-2">暂无具体指导建议</li>';
        }
        html += '</ul>';
        document.getElementById('guidanceAdvice').innerHTML = html;
    }
    
    renderNutrientBalance(result) {
        const demand = result.calc_params.nutrient_demand;
        const supply = result.calc_params.soil_supply;
        
        // 作物养分需求
        document.getElementById('nutrientDemand').innerHTML = this.renderNutrientList([
            { label: '氮(N)', value: demand[0] },
            { label: '磷(P₂O₅)', value: demand[1] },
            { label: '钾(K₂O)', value: demand[2] }
        ]);
        
        // 土壤养分供应
        document.getElementById('soilSupply').innerHTML = this.renderNutrientList([
            { label: '氮(N)', value: supply[0] },
            { label: '磷(P₂O₅)', value: supply[1] },
            { label: '钾(K₂O)', value: supply[2] }
        ]);
        
        // 肥料养分补充
        const fertSupply = this.calculateFertilizerSupply(result.fertilizer_usage);
        document.getElementById('fertilizerSupply').innerHTML = this.renderNutrientList(fertSupply);
    }
    
    renderNutrientList(items) {
        return items.map(item => `
            <div class="d-flex justify-content-between mb-2 p-2 bg-white rounded">
                <span>${item.label}</span>
                <span class="fw-bold">${Utils.formatNumber(item.value)} 公斤/亩</span>
            </div>
        `).join('');
    }
    
    calculateFertilizerSupply(usage) {
        const content = {
            '尿素': 0.46,
            '过磷酸钙': 0.12,
            '氯化钾': 0.60,
            '配方肥_N': 0.20,
            '配方肥_P': 0.15,
            '配方肥_K': 0.10
        };
        
        let N = 0, P = 0, K = 0;
        
        for (const [key, value] of Object.entries(usage)) {
            if (key.includes('尿素')) N += value * content['尿素'];
            else if (key.includes('过磷酸钙')) P += value * content['过磷酸钙'];
            else if (key.includes('氯化钾')) K += value * content['氯化钾'];
            else if (key.includes('配方肥')) {
                N += value * content['配方肥_N'];
                P += value * content['配方肥_P'];
                K += value * content['配方肥_K'];
            }
        }
        
        return [
            { label: '氮(N)', value: N },
            { label: '磷(P₂O₅)', value: P },
            { label: '钾(K₂O)', value: K }
        ];
    }
}


// ==================== 事件处理器 ====================
class EventHandlers {
    static init() {
        const elements = new DOMElements();
        const locationManager = new LocationManager(elements);
        const formHandler = new FormHandler(elements);
        const serverStatus = new ServerStatusManager(elements);
        
        // 表单提交
        elements.form.addEventListener('submit', (e) => {
            e.preventDefault();
            formHandler.submit();
        });
        
        // 土壤输入切换
        elements.customSoilToggle.addEventListener('change', function() {
            AppState.useCustomSoilData = this.checked;
            elements.soilInputs.style.display = this.checked ? 'block' : 'none';
            
            if (this.checked) {
                document.getElementById('soilInputSection').classList.add('active');
            } else {
                document.getElementById('soilInputSection').classList.remove('active');
            }
        });
        
        // 地理定位
        elements.getLocationBtn.addEventListener('click', () => {
            locationManager.getCurrentLocation();
        });
        
        // 地图折叠/展开功能
        const toggleMapBtn = document.getElementById('toggleMapBtn');
        const mapContainer = document.getElementById('mapContainer');
        const mapInfoBox = document.getElementById('mapInfoBox');
        const mapControlButtons = document.getElementById('mapControlButtons');
        const mapCardBody = document.getElementById('mapCardBody');
        
        // 手动输入经纬度折叠功能
        const toggleCoordBtn = document.getElementById('toggleCoordBtn');
        const coordContainer = document.getElementById('coordContainer');
        
        if (toggleCoordBtn && coordContainer) {
            // 初始状态：折叠
            coordContainer.style.display = 'none';
            toggleCoordBtn.innerHTML = '<i class="fas fa-chevron-down me-1"></i>展开';
            
            toggleCoordBtn.addEventListener('click', function() {
                const isCollapsed = coordContainer.style.display === 'none';
                
                if (isCollapsed) {
                    // 展开
                    coordContainer.style.display = 'block';
                    toggleCoordBtn.innerHTML = '<i class="fas fa-chevron-up me-1"></i>折叠';
                    toggleCoordBtn.classList.remove('btn-outline-secondary');
                    toggleCoordBtn.classList.add('btn-outline-success');
                } else {
                    // 折叠
                    coordContainer.style.display = 'none';
                    toggleCoordBtn.innerHTML = '<i class="fas fa-chevron-down me-1"></i>展开';
                    toggleCoordBtn.classList.remove('btn-outline-success');
                    toggleCoordBtn.classList.add('btn-outline-secondary');
                }
            });
        }
        
        if (toggleMapBtn && mapContainer) {
            // 初始状态：地图已展开（HTML中已设置display: block和map-container-expanded）
            // 确保地图容器有正确的类
            if (!mapContainer.classList.contains('map-container-expanded')) {
                mapContainer.classList.remove('map-container-collapsed');
                mapContainer.classList.add('map-container-expanded');
            }
            
            toggleMapBtn.addEventListener('click', function() {
                const isCollapsed = mapContainer.classList.contains('map-container-collapsed');
                
                if (isCollapsed) {
                    // 展开地图
                    mapContainer.classList.remove('map-container-collapsed');
                    mapContainer.classList.add('map-container-expanded');
                    mapCardBody.style.display = 'block';
                    mapInfoBox.style.display = 'block';
                    mapControlButtons.style.display = 'flex';
                    toggleMapBtn.innerHTML = '<i class="fas fa-chevron-up me-1"></i>折叠地图';
                    toggleMapBtn.classList.remove('btn-outline-secondary');
                    toggleMapBtn.classList.add('btn-outline-success');
                    
                    // 触发地图重新调整大小
                    if (AppState.map && AppState.map.map) {
                        setTimeout(() => {
                            AppState.map.map.resize();
                        }, 350);
                    }
                } else {
                    // 折叠地图
                    mapContainer.classList.add('map-container-collapsed');
                    mapContainer.classList.remove('map-container-expanded');
                    mapCardBody.style.display = 'none';
                    mapInfoBox.style.display = 'none';
                    mapControlButtons.style.display = 'none';
                    toggleMapBtn.innerHTML = '<i class="fas fa-chevron-down me-1"></i>展开地图';
                    toggleMapBtn.classList.remove('btn-outline-success');
                    toggleMapBtn.classList.add('btn-outline-secondary');
                }
            });
        }
        
        // 重新定位（GPS + 网络定位）
        const relocateBtn = document.getElementById('relocateBtn');
        if (relocateBtn) {
            relocateBtn.addEventListener('click', async () => {
                relocateBtn.disabled = true;
                relocateBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>定位中...';
                
                try {
                    const geoManager = new GeoLocationManager();
                    const location = await geoManager.getUserLocation();
                    
                    elements.lonInput.value = location.lon.toFixed(4);
                    elements.latInput.value = location.lat.toFixed(4);
                    
                    if (AppState.map) {
                        AppState.map.updateMarker(location.lon, location.lat, false);
                    }
                    
                    locationManager.updateLocationInfo();
                    Utils.showNotification(`✓ ${location.source}成功: ${location.city || ''} (${location.lon.toFixed(4)}, ${location.lat.toFixed(4)})`, 'success');
                } catch (error) {
                    console.error('重新定位失败:', error);
                    Utils.showNotification('⚠️ 定位失败，请检查网络和权限设置', 'warning');
                } finally {
                    relocateBtn.disabled = false;
                    relocateBtn.innerHTML = '<i class="fas fa-location-arrow me-1"></i>重新定位';
                }
            });
        }
        
        // 城市选择
        elements.selectCityBtn.addEventListener('click', function() {
            const isVisible = elements.citySelect.style.display !== 'none';
            elements.citySelect.style.display = isVisible ? 'none' : 'block';
            this.innerHTML = isVisible 
                ? '<i class="fas fa-city me-1"></i>选择城市' 
                : '<i class="fas fa-times me-1"></i>取消选择';
        });
        
        elements.citySelect.addEventListener('change', function() {
            const city = this.value;
            if (city) {
                locationManager.setCity(city);
                this.style.display = 'none';
                elements.selectCityBtn.innerHTML = '<i class="fas fa-city me-1"></i>选择城市';
                Utils.showNotification(`已选择城市: ${city}`, 'success');
            }
        });
        
        // 经纬度变化监听 - 同步更新地图
        const updateMapFromInput = Utils.debounce(() => {
            const lon = parseFloat(elements.lonInput.value);
            const lat = parseFloat(elements.latInput.value);

            if (!isNaN(lon) && !isNaN(lat)) {
                if (AppState.map) {
                    AppState.map.updateMarker(lon, lat, false);
                }
                AppState.userLocation = null;
                locationManager.updateLocationInfo();
            }
        }, 500);

        elements.lonInput.addEventListener('input', updateMapFromInput);
        elements.latInput.addEventListener('input', updateMapFromInput);
        
        // 作物类型变化
        document.querySelectorAll('input[name="crop"]').forEach(radio => {
            radio.addEventListener('change', function() {
                const cropType = this.value;
                const coords = cropType === '水稻'
                    ? CITY_COORDS['南京']
                    : CITY_COORDS['武汉'];

                elements.lonInput.value = coords.lon;
                elements.latInput.value = coords.lat;

                if (AppState.map) {
                    AppState.map.updateMarker(coords.lon, coords.lat, false);
                }

                AppState.userLocation = null;
                locationManager.updateLocationInfo();
            });
        });
        
        
        // 按钮事件
        elements.resetBtn.addEventListener('click', () => {
            elements.resultSection.style.display = 'none';
            elements.form.reset();
            elements.dateInput.value = '';
            elements.yieldInput.value = 500;
            elements.soilInputs.style.display = 'none';
            elements.customSoilToggle.checked = false;
            AppState.useCustomSoilData = false;
            AppState.userLocation = null;
            elements.citySelect.style.display = 'none';
            elements.selectCityBtn.innerHTML = '<i class="fas fa-city me-1"></i>选择城市';
            locationManager.clearStatus();

            // 重置地图到默认位置
            if (AppState.map) {
                AppState.map.updateMarker(118.763, 32.057, true);
            }

            locationManager.updateLocationInfo();
            Utils.showNotification('已重置表单', 'info');
        });
        
        elements.printBtn.addEventListener('click', () => {
            window.print();
        });
        
        elements.saveDataBtn.addEventListener('click', () => {
            if (!AppState.lastCalculation) {
                Utils.showNotification('没有可保存的数据', 'warning');
                return;
            }
            
            const { data, result } = AppState.lastCalculation;
            const filename = `施肥方案_${data.crop}_${new Date().toISOString().slice(0, 10)}.txt`;
            
            let content = `科学施肥推荐系统 - 施肥方案\n`;
            content += `生成时间: ${new Date().toLocaleString()}\n`;
            content += `数据模式: ${AppState.currentDataMode === 'online' ? '在线数据' : '离线模拟数据'}\n`;
            content += `土壤数据: ${AppState.useCustomSoilData ? '手动输入' : '自动获取'}\n\n`;
            content += `作物类型: ${data.crop}\n`;
            content += `目标产量: ${data.yield} 公斤/亩\n`;
            content += `播种日期: ${data.date}\n`;
            content += `地理位置: 经度 ${data.lon}°, 纬度 ${data.lat}°\n\n`;
            
            content += `=== 肥料用量 ===\n`;
            for (const [key, value] of Object.entries(result.fertilizer_usage)) {
                content += `${key}: ${value} 公斤/亩\n`;
            }
            
            content += `\n=== 指导意见 ===\n`;
            result.guidance.forEach((item, i) => content += `${item}\n`);
            
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            Utils.showNotification('方案已保存为文本文件', 'success');
        });
        
        elements.exportBtn.addEventListener('click', () => {
            Utils.showNotification('导出功能正在开发中,当前版本支持打印和文本保存。', 'info');
        });
        
        elements.testDataBtn.addEventListener('click', async () => {
            const lon = elements.lonInput.value;
            const lat = elements.latInput.value;
            
            const validation = Utils.validateCoordinates(lon, lat);
            if (!validation.valid) {
                Utils.showNotification(validation.message, 'danger');
                return;
            }
            
            Utils.showLoading('正在测试土壤数据获取...');
            
            try {
                const data = await APIService.testSoilData(validation.lon, validation.lat);
                Utils.hideLoading();
                
                if (data.success) {
                    let message = `土壤养分测试结果:\n\n`;
                    for (const [key, value] of Object.entries(data.nutrients)) {
                        message += `${value.description}: ${value.value} mg/kg (${value.nutrient_level})\n`;
                    }
                    message += `\n数据来源: ${data.nutrients.AN.data_source}`;
                    
                    if (AppState.useCustomSoilData && !data.is_default_data) {
                        const fill = confirm(`${message}\n\n是否将这些值填充到手动输入框中?`);
                        if (fill) {
                            elements.soilNInput.value = data.nutrients.AN.value;
                            elements.soilPInput.value = data.nutrients.AP.value;
                            elements.soilKInput.value = data.nutrients.AK.value;
                            Utils.showNotification('已填充土壤数据', 'success');
                        }
                    } else {
                        alert(message);
                    }
                } else {
                    throw new Error(data.error || '测试失败');
                }
            } catch (error) {
                Utils.hideLoading();
                Utils.showNotification(`土壤数据测试失败: ${error.message}`, 'danger');
            }
        });
        
        // 导航链接
        elements.aboutLink.addEventListener('click', (e) => {
            e.preventDefault();
            const modal = new bootstrap.Modal(document.getElementById('aboutModal'));
            modal.show();
        });
        
        elements.techLink.addEventListener('click', (e) => {
            e.preventDefault();
            alert('技术原理:\n\n' +
                  '1. 基于土壤养分平衡原理\n' +
                  '2. 考虑作物养分吸收规律\n' +
                  '3. 结合GIS土壤数据库\n' +
                  '4. 采用精准施肥算法\n' +
                  '5. 支持手动输入土壤养分数据\n\n' +
                  '系统支持在线和离线两种模式,确保在不同网络环境下都能使用。');
        });
        
        elements.contactLink.addEventListener('click', (e) => {
            e.preventDefault();
            alert('联系我们:\n\n' +
                  '华中农业大学\n' +
                  '电话: 027-12345678\n' +
                  '邮箱: zmhou@qq.com\n\n' +
                  '技术支持时间: 工作日 9:00-17:00');
        });

        document.getElementById('reloadMapBtn').addEventListener('click', function() {
            if (typeof AMap !== 'undefined') {
                if (AppState.map) {
                    AppState.map.destroy();
                    AppState.map = null;
                    AppState.marker = null;
                }
                setTimeout(() => {
                    const elements = new DOMElements();
                    const mapManager = new MapManager();
                    const initialLon = parseFloat(elements.lonInput.value) || null;
                    const initialLat = parseFloat(elements.latInput.value) || null;
                    mapManager.initMap(initialLon, initialLat).then(() => {
                        AppState.map = mapManager;
                    });
                }, 100);
            }
        });
    }
}

// ==================== 应用初始化 ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('='.repeat(50));
    console.log('科学施肥推荐系统 v2.0.0 (含地图选点功能)');
    console.log('='.repeat(50));

    const elements = new DOMElements();
    const locationManager = new LocationManager(elements);
    const serverStatus = new ServerStatusManager(elements);

    // 初始化地图（支持自动定位）
    const mapManager = new MapManager();
    const initialLon = parseFloat(elements.lonInput.value) || null;
    const initialLat = parseFloat(elements.latInput.value) || null;
    
    // 异步初始化地图
    mapManager.initMap(initialLon, initialLat).then(() => {
        AppState.map = mapManager;
        console.log('✓ 地图初始化完成');
    }).catch((error) => {
        console.error('❌ 地图初始化失败:', error);
    });

    // 设置默认日期为当前日期
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    elements.dateInput.value = `${year}-${month}-${day}`;

    // 初始化位置信息
    locationManager.updateLocationInfo();

    // 检查服务器状态
    serverStatus.check();

    // 定期检查服务器状态(每分钟)
    setInterval(() => serverStatus.check(), 60000);

    // 初始化事件处理器
    EventHandlers.init();

    console.log('应用初始化完成');
    console.log('当前模式:', AppState.currentDataMode);
    console.log('服务器状态:', AppState.isServerOnline ? '在线' : '离线');
    console.log('土壤数据输入:', AppState.useCustomSoilData ? '手动输入' : '自动获取');
    console.log('地图状态:', AppState.map ? '已加载' : '未加载');
});

// 全局函数 - 用于HTML内联调用
function hideOfflineAlert() {
    const elements = new DOMElements();
    new ServerStatusManager(elements).hideOfflineAlert();
}
