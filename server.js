/**
 * 科学施肥推荐系统 - Node.js/Express 后台服务器
 * 对应原 Python Flask app.py
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cookieParser = require('cookie-parser');
const Database = require('./database_js');
const GeoTIFF = require('geotiff');

// ==================== 应用初始化 ====================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// ==================== GeoTIFF 土壤数据读取 ====================
const GEOTIFF_FILES = {
  AN: path.join(__dirname, 'GTiff', 'AN_5-15cm_1km_clip.tif'),
  AP: path.join(__dirname, 'GTiff', 'AP_5-15cm_1km_clip.tif'),
  AK: path.join(__dirname, 'GTiff', 'AK_5-15cm_1km_clip.tif')
};

// GeoTIFF 缓存
let geotiffCache = {
  AN: null, AP: null, AK: null,
  metadata: null
};

/**
 * 加载并缓存GeoTIFF文件
 */
async function loadGeoTIFFs() {
  try {
    console.log('[GeoTIFF] 开始加载土壤数据文件...');
    
    for (const [key, filePath] of Object.entries(GEOTIFF_FILES)) {
      if (fs.existsSync(filePath)) {
        try {
          const tiff = await GeoTIFF.fromFile(filePath);
          const image = await tiff.getImage();
          const rasters = await image.readRasters();
          const bbox = image.getBoundingBox();
          const width = image.getWidth();
          const height = image.getHeight();
          
          geotiffCache[key] = {
            data: rasters[0],
            width,
            height,
            bbox,
            minX: bbox[0],
            maxY: bbox[3],
            maxX: bbox[2],
            minY: bbox[1],
            cellWidth: (bbox[2] - bbox[0]) / width,
            cellHeight: (bbox[3] - bbox[1]) / height
          };
          
          console.log(`[GeoTIFF] ${key} 加载成功: ${width}x${height}, 范围: [${bbox.join(', ')}]`);
        } catch (e) {
          console.warn(`[GeoTIFF] ${key} 加载失败:`, e.message);
        }
      } else {
        console.warn(`[GeoTIFF] 文件不存在: ${filePath}`);
      }
    }
    
    geotiffCache.metadata = { loaded: true, timestamp: Date.now() };
    return true;
  } catch (e) {
    console.error('[GeoTIFF] 加载失败:', e.message);
    return false;
  }
}

/**
 * 从GeoTIFF中提取指定坐标的像素值
 */
function extractValueFromGeoTIFF(lon, lat, layer) {
  const cache = geotiffCache[layer];
  if (!cache || !cache.data) return null;
  
  // 检查坐标是否在范围内
  if (lon < cache.minX || lon > cache.maxX || lat < cache.minY || lat > cache.maxY) {
    return null;
  }
  
  // 计算像素位置
  const col = Math.floor((lon - cache.minX) / cache.cellWidth);
  const row = Math.floor((cache.maxY - lat) / cache.cellHeight);
  
  // 边界检查
  if (col < 0 || col >= cache.width || row < 0 || row >= cache.height) {
    return null;
  }
  
  // 获取像素值
  const idx = row * cache.width + col;
  const value = cache.data[idx];
  
  // 检查是否为NoData值（通常为负数或极大值）
  if (value < -9999 || value > 100000 || value === -9999 || value === -32768) {
    return null;
  }
  
  return value;
}

/**
 * 从GeoTIFF获取土壤养分数据
 */
function getSoilNutrientsFromGeoTIFF(lon, lat) {
  const AN = extractValueFromGeoTIFF(lon, lat, 'AN');
  const AP = extractValueFromGeoTIFF(lon, lat, 'AP');
  const AK = extractValueFromGeoTIFF(lon, lat, 'AK');

  const hasValidData = AN !== null || AP !== null || AK !== null;

  // 比例因子配置
  const scaleFactors = {
    AN: 10,
    AP: 100,
    AK: 10
  };

  return {
    AN: AN !== null ? {
      value: Math.round(AN ) / 10,
      raw_value: AN,
      layer: 'AN',
      description: '土壤碱解氮含量 (mg/kg)',
      nutrient_level: getNutrientLevel(AN / scaleFactors.AN, 'AN'),
      data_source: 'GeoTIFF',
      is_default: false
    } : null,
    AP: AP !== null ? {
      value: Math.round(AP) / 100,
      raw_value: AP,
      layer: 'AP',
      description: '土壤有效磷含量 (mg/kg)',
      nutrient_level: getNutrientLevel(AP / scaleFactors.AP, 'AP'),
      data_source: 'GeoTIFF',
      is_default: false
    } : null,
    AK: AK !== null ? {
      value: Math.round(AK) / 10,
      raw_value: AK,
      layer: 'AK',
      description: '土壤有效钾含量 (mg/kg)',
      nutrient_level: getNutrientLevel(AK / scaleFactors.AK, 'AK'),
      data_source: 'GeoTIFF',
      is_default: false
    } : null,
    has_valid_data: hasValidData,
    coordinate: { lon, lat }
  };
}

// ==================== 城市坐标映射 ====================
const CITY_COORDS = {
  '南京': { lon: 118.763, lat: 32.057, adcode: '320100' },
  '武汉': { lon: 114.305, lat: 30.592, adcode: '420100' },
  '长沙': { lon: 112.938, lat: 28.228, adcode: '430100' },
  '南昌': { lon: 115.858, lat: 28.676, adcode: '360100' },
  '杭州': { lon: 120.153, lat: 30.267, adcode: '330100' },
  '上海': { lon: 121.473, lat: 31.230, adcode: '310100' },
  '合肥': { lon: 117.283, lat: 31.861, adcode: '340100' }
};

// ==================== GeoJSON 数据加载 ====================
let fertilizerFeatures = [];
let farmingFeatures = [];

function parsePercentRange(s) {
  if (!s) return null;
  const nums = String(s).match(/(\d+(?:\.\d+)?)/g);
  if (!nums) return null;
  const vals = nums.map(Number);
  return vals.reduce((a, b) => a + b, 0) / vals.length / 100.0;
}

function loadFertilizerGeoJSON() {
  const geojsonPath = path.join(__dirname, '长江中下游稻麦轮作肥料利用率.geojson');
  if (!fs.existsSync(geojsonPath)) return;
  const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
  for (const feat of data.features || []) {
    const props = feat.properties || {};
    const geom = feat.geometry || {};
    if (geom.type !== 'Point' || !geom.coordinates) continue;
    fertilizerFeatures.push({
      coords: geom.coordinates,
      crop: (props.crop || '').trim(),
      N: parsePercentRange(props.nitrogen_efficiency),
      P: parsePercentRange(props.phosphorus_efficiency),
      K: parsePercentRange(props.potassium_efficiency),
      properties: props
    });
  }
}

function parsePlantingTimeRange(s) {
  if (!s) return [null, null];
  const year = new Date().getFullYear();
  const matches = [...String(s).matchAll(/(\d{1,2})月(\d{1,2})日/g)];
  if (matches.length === 0) return [null, null];
  if (matches.length === 1) {
    const m = matches[0][1].padStart(2, '0');
    const d = matches[0][2].padStart(2, '0');
    const dateStr = `${year}-${m}-${d}`;
    return [dateStr, dateStr];
  }
  const m1 = matches[0][1].padStart(2, '0'), d1 = matches[0][2].padStart(2, '0');
  const m2 = matches[1][1].padStart(2, '0'), d2 = matches[1][2].padStart(2, '0');
  return [`${year}-${m1}-${d1}`, `${year}-${m2}-${d2}`];
}

function loadFarmingScheduleGeoJSON() {
  const geojsonPath = path.join(__dirname, '长江中下游稻麦轮作农时表.geojson');
  if (!fs.existsSync(geojsonPath)) return;
  const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf-8'));
  for (const feat of data.features || []) {
    const props = feat.properties || {};
    const geom = feat.geometry || {};
    if (geom.type !== 'Point' || !geom.coordinates) continue;
    const [sowingStart, sowingEnd] = parsePlantingTimeRange(props.planting_time);
    farmingFeatures.push({
      coords: geom.coordinates,
      crop: (props.crop || '').trim(),
      planting_time: props.planting_time,
      sowing_date_start: sowingStart,
      sowing_date_end: sowingEnd,
      properties: props
    });
  }
}

// 加载GeoJSON数据
try { loadFertilizerGeoJSON(); } catch (e) { console.warn('加载肥料利用率GeoJSON失败:', e.message); }
try { loadFarmingScheduleGeoJSON(); } catch (e) { console.warn('加载农时表GeoJSON失败:', e.message); }

// ==================== 施肥模型 ====================
class CropRotationFertilizerModel {
  constructor() {
    this.defaultParams = {
      urea_N_content: 0.46,
      superphosphate_P_content: 0.12,
      potassium_chloride_K_content: 0.60,
      rice: {
        N_per_100kg: 2.2, P_per_100kg: 1.2, K_per_100kg: 2.5,
        normal_sowing_date: '06-17',
        straw_N: 0.6, straw_P: 0.1, straw_K: 1.8,
        straw_moisture: 40, straw_CN_ratio: 80,
        N_release_rate: -0.6, P_release_rate: 0.65, K_release_rate: 0.80,
        N_fertilizer_efficiency: 0.30, P_fertilizer_efficiency: 0.25, K_fertilizer_efficiency: 0.45,
      },
      wheat: {
        N_per_100kg: 3.0, P_per_100kg: 1.5, K_per_100kg: 2.8,
        normal_sowing_date: '11-01',
        straw_N: 0.5, straw_P: 0.1, straw_K: 1.2,
        straw_moisture: 15, straw_CN_ratio: 70,
        N_release_rate: 0.35, P_release_rate: 0.75, K_release_rate: 0.90,
        N_fertilizer_efficiency: 0.40, P_fertilizer_efficiency: 0.18, K_fertilizer_efficiency: 0.50,
        yield_levels: [
          { min: 0, max: 300, base_fertilizer: [25, 30], urea_tillering: [6, 8] },
          { min: 300, max: 400, base_fertilizer: [30, 40], urea_tillering: [8, 10] },
          { min: 400, max: 500, base_fertilizer: [40, 50], urea_tillering: [10, 12] },
          { min: 500, max: Infinity, base_fertilizer: [50, 55], urea_tillering: [12, 14] }
        ],
        formula_ratio: [20, 15, 10]
      },
      soil_impact: {
        organic_matter_impact: {
          N: (om) => 1 + 0.015 * (om - 20),
          P: (om) => 1 + 0.01 * (om - 20),
          K: (om) => 1 + 0.008 * (om - 20)
        },
        ph_impact_on_p: {
          optimal_range: [6.0, 7.0],
          adjustment: (ph) => (ph >= 6.0 && ph <= 7.0) ? 1.0 : 0.7
        },
        ph_impact_on_micro: {
          Zn: (ph) => ph < 7.5 ? 1.0 : 0.5,
          B: (ph) => ph < 7.0 ? 1.0 : 0.6
        }
      }
    };
  }

  sqdist(a, b) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }

  getFertilizerEfficiency(lon, lat, cropType) {
    if (!fertilizerFeatures.length) return [null, null, null];
    const cropMap = { rice: '水稻', wheat: '冬小麦' };
    const targetCrop = cropMap[cropType] || cropType;
    let candidates = fertilizerFeatures.filter(f => f.crop === targetCrop && f.N !== null);
    if (!candidates.length) candidates = fertilizerFeatures.filter(f => f.N !== null);
    if (!candidates.length) return [null, null, null];
    const nearest = candidates.reduce((best, f) =>
      this.sqdist(f.coords, [lon, lat]) < this.sqdist(best.coords, [lon, lat]) ? f : best);
    return [nearest.N, nearest.P, nearest.K];
  }

  getSowingDate(lon, lat, cropType) {
    if (!farmingFeatures.length) return null;
    const cropMap = { rice: '水稻', wheat: '冬小麦' };
    const targetCrop = cropMap[cropType] || cropType;
    let candidates = farmingFeatures.filter(f => f.crop === targetCrop && f.sowing_date_start);
    if (!candidates.length) candidates = farmingFeatures.filter(f => f.sowing_date_start);
    if (!candidates.length) return null;
    const nearest = candidates.reduce((best, f) =>
      this.sqdist(f.coords, [lon, lat]) < this.sqdist(best.coords, [lon, lat]) ? f : best);
    return { start: nearest.sowing_date_start, end: nearest.sowing_date_end };
  }

  getSimulatedSoilNutrients(lon, lat) {
    const baseAN = 89.2 + (lon - 114) * 2 + (lat - 30) * 3;
    const baseAP = 23.8 + (lon - 114) * 0.5 + (lat - 30) * 0.8;
    const baseAK = 105.0 + (lon - 114) * 1.5 + (lat - 30) * 2;
    const rand = (min, max) => Math.random() * (max - min) + min;
    const AN = Math.max(50, Math.min(150, baseAN + rand(-10, 10)));
    const AP = Math.max(5, Math.min(40, baseAP + rand(-5, 5)));
    const AK = Math.max(60, Math.min(200, baseAK + rand(-20, 20)));
    return {
      soil_N: Math.round(AN * 10) / 10,
      soil_P: Math.round(AP * 10) / 10,
      soil_K: Math.round(AK * 10) / 10,
      nutrient_levels: {
        AN: getNutrientLevel(AN, 'AN'),
        AP: getNutrientLevel(AP, 'AP'),
        AK: getNutrientLevel(AK, 'AK')
      },
      data_source: { AN: '模拟数据', AP: '模拟数据', AK: '模拟数据' },
      is_default: true
    };
  }

  getSoilNutrientsWithCustom(lon, lat, customSoilData) {
    // 优先从GeoTIFF获取土壤数据
    const geoTiffData = getSoilNutrientsFromGeoTIFF(lon, lat);
    
    // 初始化基础数据
    let baseData = {
      soil_N: null,
      soil_P: null,
      soil_K: null,
      nutrient_levels: { AN: '未知', AP: '未知', AK: '未知' },
      data_source: { AN: '模拟数据', AP: '模拟数据', AK: '模拟数据' },
      is_default: true,
      use_custom: false
    };
    
    // 从GeoTIFF获取数据（如果可用）
    if (geoTiffData.has_valid_data) {
      if (geoTiffData.AN) {
        baseData.soil_N = geoTiffData.AN.value;
        baseData.nutrient_levels.AN = geoTiffData.AN.nutrient_level;
        baseData.data_source.AN = 'GeoTIFF';
        baseData.is_default = false;
      }
      if (geoTiffData.AP) {
        baseData.soil_P = geoTiffData.AP.value;
        baseData.nutrient_levels.AP = geoTiffData.AP.nutrient_level;
        baseData.data_source.AP = 'GeoTIFF';
        baseData.is_default = false;
      }
      if (geoTiffData.AK) {
        baseData.soil_K = geoTiffData.AK.value;
        baseData.nutrient_levels.AK = geoTiffData.AK.nutrient_level;
        baseData.data_source.AK = 'GeoTIFF';
        baseData.is_default = false;
      }
    }
    
    // 如果GeoTIFF数据不完整，使用模拟数据填充
    const simulated = this.getSimulatedSoilNutrients(lon, lat);
    if (baseData.soil_N === null) {
      baseData.soil_N = simulated.soil_N;
      baseData.nutrient_levels.AN = simulated.nutrient_levels.AN;
      baseData.data_source.AN = '模拟数据';
    }
    if (baseData.soil_P === null) {
      baseData.soil_P = simulated.soil_P;
      baseData.nutrient_levels.AP = simulated.nutrient_levels.AP;
      baseData.data_source.AP = '模拟数据';
    }
    if (baseData.soil_K === null) {
      baseData.soil_K = simulated.soil_K;
      baseData.nutrient_levels.AK = simulated.nutrient_levels.AK;
      baseData.data_source.AK = '模拟数据';
    }
    
    // 处理自定义土壤数据（手动输入优先级最高）
    if (customSoilData) {
      let useCustom = false;
      if (customSoilData.N != null) { 
        baseData.soil_N = customSoilData.N; 
        baseData.data_source.AN = '手动输入'; 
        baseData.nutrient_levels.AN = this.getNutrientLevelFromValue(customSoilData.N, 'AN');
        useCustom = true; 
      }
      if (customSoilData.P != null) { 
        baseData.soil_P = customSoilData.P; 
        baseData.data_source.AP = '手动输入'; 
        baseData.nutrient_levels.AP = this.getNutrientLevelFromValue(customSoilData.P, 'AP');
        useCustom = true; 
      }
      if (customSoilData.K != null) { 
        baseData.soil_K = customSoilData.K; 
        baseData.data_source.AK = '手动输入'; 
        baseData.nutrient_levels.AK = this.getNutrientLevelFromValue(customSoilData.K, 'AK');
        useCustom = true; 
      }
      baseData.use_custom = useCustom;
    }
    
    return baseData;
  }

  getNutrientLevelFromValue(value, type) {
    return getNutrientLevel(value, type);
  }

  calculateNutrientRequirement(targetYield, cropType) {
    const p = this.defaultParams[cropType];
    return [
      (targetYield / 100) * p.N_per_100kg,
      (targetYield / 100) * p.P_per_100kg,
      (targetYield / 100) * p.K_per_100kg
    ];
  }

  calculateSoilSupply(soilN, soilP, soilK, organicMatter, soilPh, cropType) {
    const convFactor = 0.15;
    let nCorr, pCorr, kCorr;
    if (cropType === 'rice') {
      nCorr = (3.2164 + 4799.9239 / soilN) / 100;
      pCorr = (17.4898 + 2235.9674 / soilP) / 100;
      kCorr = (10.7412 + 6147.1032 / soilK) / 100;
    } else {
      nCorr = 0.821222 * Math.exp(-0.005429 * soilN);
      pCorr = 1.976 * Math.exp(-0.041744 * soilP);
      kCorr = 1.1038 * Math.exp(-0.006362 * soilK);
    }
    const omImpact = this.defaultParams.soil_impact.organic_matter_impact;
    const phImpact = this.defaultParams.soil_impact.ph_impact_on_p.adjustment(soilPh);
    let nSupply = soilN * convFactor * nCorr * omImpact.N(organicMatter);
    let pSupply = soilP * convFactor * pCorr * omImpact.P(organicMatter) * phImpact;
    let kSupply = soilK * convFactor * kCorr * omImpact.K(organicMatter);
    return [nSupply, pSupply, kSupply, {
      organic_matter_impact: {
        N: omImpact.N(organicMatter),
        P: omImpact.P(organicMatter),
        K: omImpact.K(organicMatter)
      },
      ph_impact_on_p: phImpact
    }];
  }

  calculateStrawSupply(amount, strawType) {
    if (amount <= 0) return [0, 0, 0, 0];
    const p = this.defaultParams[strawType];
    const dryWeight = amount * (1 - p.straw_moisture / 100);
    const nTotal = dryWeight * (p.straw_N / 100);
    const pTotal = dryWeight * (p.straw_P / 100);
    const kTotal = dryWeight * (p.straw_K / 100);
    return [
      nTotal * p.N_release_rate,
      pTotal * p.P_release_rate,
      kTotal * p.K_release_rate,
      dryWeight * 0.005
    ];
  }

  adjustFertilizerRatio(sowingDate, cropType, tempForecast) {
    try {
      const actualDate = new Date(sowingDate);
      const year = actualDate.getFullYear();
      const normalDateStr = this.defaultParams[cropType].normal_sowing_date;
      const normalDate = new Date(`${year}-${normalDateStr}`);
      const daysDiff = Math.round((actualDate - normalDate) / 86400000);

      if (cropType === 'rice') {
        let [base, tiller, panicle] = daysDiff < -7 ? [0.40, 0.25, 0.35] :
          daysDiff > 7 ? [0.55, 0.30, 0.15] : [0.50, 0.25, 0.25];
        if (tempForecast < 20) { base += 0.05; panicle -= 0.05; }
        return {
          base_ratio: Math.max(0, Math.min(1, base)),
          tiller_ratio: Math.max(0, Math.min(1, tiller)),
          panicle_ratio: Math.max(0, Math.min(1, panicle))
        };
      } else {
        let [base, joint, boot] = daysDiff < -7 ? [0.60, 0.25, 0.15] :
          daysDiff > 7 ? [0.70, 0.20, 0.10] : [0.65, 0.25, 0.10];
        if (tempForecast < 10) { base += 0.05; boot -= 0.05; }
        return {
          base_ratio: Math.max(0, Math.min(1, base)),
          jointing_ratio: Math.max(0, Math.min(1, joint)),
          booting_ratio: Math.max(0, Math.min(1, boot))
        };
      }
    } catch (e) {
      return cropType === 'rice'
        ? { base_ratio: 0.50, tiller_ratio: 0.25, panicle_ratio: 0.25 }
        : { base_ratio: 0.65, jointing_ratio: 0.25, booting_ratio: 0.10 };
    }
  }

  getWheatFertilizerByYield(targetYield) {
    const levels = this.defaultParams.wheat.yield_levels;
    const level = levels.find(l => targetYield >= l.min && targetYield <= l.max) || levels[levels.length - 1];
    return [
      (level.base_fertilizer[0] + level.base_fertilizer[1]) / 2,
      (level.urea_tillering[0] + level.urea_tillering[1]) / 2
    ];
  }

  calculateFertilizerRecommendation(inputParams, cropType, strawSourceType = null) {
    const targetYield = inputParams.target_yield || 500;
    const customSoilData = inputParams.custom_soil_data;
    const lon = parseFloat(inputParams.lon) || 114.305;
    const lat = parseFloat(inputParams.lat) || 30.592;

    // 获取土壤数据
    let soilData;
    if (inputParams.lon != null && inputParams.lat != null) {
      soilData = this.getSoilNutrientsWithCustom(lon, lat, customSoilData);
    } else if (customSoilData && inputParams.use_custom_soil) {
      soilData = {
        soil_N: customSoilData.N ?? 89.2,
        soil_P: customSoilData.P ?? 23.8,
        soil_K: customSoilData.K ?? 105.0,
        nutrient_levels: {
          AN: this.getNutrientLevelFromValue(customSoilData.N ?? 89.2, 'AN'),
          AP: this.getNutrientLevelFromValue(customSoilData.P ?? 23.8, 'AP'),
          AK: this.getNutrientLevelFromValue(customSoilData.K ?? 105.0, 'AK')
        },
        data_source: { AN: '手动输入', AP: '手动输入', AK: '手动输入' },
        is_default: true,
        use_custom: true
      };
    } else {
      const dN = cropType === 'rice' ? 89.2 : 89;
      const dP = cropType === 'rice' ? 23.83 : 23;
      const dK = cropType === 'rice' ? 105 : 90;
      soilData = {
        soil_N: dN, soil_P: dP, soil_K: dK,
        nutrient_levels: { AN: '默认值', AP: '默认值', AK: '默认值' },
        data_source: { AN: '默认值', AP: '默认值', AK: '默认值' },
        is_default: true, use_custom: false
      };
    }

    const { soil_N, soil_P, soil_K, nutrient_levels, data_source, is_default, use_custom } = soilData;
    const organicMatter = inputParams.organic_matter ?? 20.7;
    const soilPh = inputParams.soil_ph ?? 8.18;
    const strawAmount = inputParams.straw_return_amount ?? (cropType === 'rice' ? 600 : 700);

    // 确定播期
    let sowingDate = inputParams.sowing_date;
    let sowingDateStart = null, sowingDateEnd = null;
    if (inputParams.lon != null && inputParams.lat != null) {
      try {
        const sdGeo = this.getSowingDate(lon, lat, cropType);
        if (sdGeo) {
          sowingDateStart = sdGeo.start;
          sowingDateEnd = sdGeo.end;
          if (!sowingDate) sowingDate = sowingDateStart;
        }
      } catch (e) { /* 使用原有值 */ }
    }
    if (!sowingDate) {
      sowingDate = cropType === 'rice' ? '2026-06-17' : '2026-11-01';
      if (!sowingDateStart) sowingDateStart = sowingDate;
      if (!sowingDateEnd) sowingDateEnd = sowingDate;
    }

    const tempForecast = inputParams.temperature_forecast ?? (cropType === 'rice' ? 22.5 : 12.0);
    if (!strawSourceType) strawSourceType = cropType === 'rice' ? 'wheat' : 'rice';

    // 1. 作物需肥量
    const [nReq, pReq, kReq] = this.calculateNutrientRequirement(targetYield, cropType);

    // 2. 土壤供肥量
    const [nSoil, pSoil, kSoil, soilImpact] = this.calculateSoilSupply(soil_N, soil_P, soil_K, organicMatter, soilPh, cropType);

    // 3. 秸秆还田供肥量
    const [nStraw, pStraw, kStraw, nAdditional] = this.calculateStrawSupply(strawAmount, strawSourceType);

    // 4. pH影响
    const phImpactOnP = this.defaultParams.soil_impact.ph_impact_on_p.adjustment(soilPh);

    // 5. 肥料利用率 (从GeoJSON)
    let [nEffGeo, pEffGeo, kEffGeo] = [null, null, null];
    if (inputParams.lon != null && inputParams.lat != null) {
      [nEffGeo, pEffGeo, kEffGeo] = this.getFertilizerEfficiency(lon, lat, cropType);
    }
    const cropP = this.defaultParams[cropType];
    const nEff = nEffGeo ?? cropP.N_fertilizer_efficiency;
    const pEff = pEffGeo ?? cropP.P_fertilizer_efficiency;
    const kEff = kEffGeo ?? cropP.K_fertilizer_efficiency;
    const pEfficiency = pEff * phImpactOnP;

    // 6. 计算需要补充的肥料量
    const nFertilizer = Math.max(0, (nReq - nSoil - nStraw) / nEff);
    const pFertilizer = Math.max(0, (pReq - pSoil - pStraw) / pEfficiency);
    const kFertilizer = Math.max(0, (kReq - kSoil - kStraw) / kEff);

    // 7. 调整肥料运筹比例
    const ratioParams = this.adjustFertilizerRatio(sowingDate, cropType, tempForecast);

    // 8. 计算各期施用量
    const dp = this.defaultParams;
    let recommendation;

    if (cropType === 'rice') {
      const nBase = nFertilizer * (ratioParams.base_ratio || 0.50) + nAdditional;
      const nTiller = nFertilizer * (ratioParams.tiller_ratio || 0.25);
      const nPanicle = nFertilizer * (ratioParams.panicle_ratio || 0.25);
      recommendation = {
        '肥料用量_公斤每亩': {
          '尿素_基肥': Math.round(nBase / dp.urea_N_content * 10) / 10,
          '尿素_分蘖肥': Math.round(nTiller / dp.urea_N_content * 10) / 10,
          '尿素_穗肥': Math.round(nPanicle / dp.urea_N_content * 10) / 10,
          '过磷酸钙_基肥': Math.round(pFertilizer / dp.superphosphate_P_content * 10) / 10,
          '氯化钾_基肥': Math.round(kFertilizer * 0.6 / dp.potassium_chloride_K_content * 10) / 10,
          '氯化钾_穗肥': Math.round(kFertilizer * 0.4 / dp.potassium_chloride_K_content * 10) / 10,
        },
        '养分用量_公斤每亩': {
          'N_基肥': Math.round(nBase * 10) / 10,
          'N_分蘖肥': Math.round(nTiller * 10) / 10,
          'N_穗肥': Math.round(nPanicle * 10) / 10,
          'P2O5_总量': Math.round(pFertilizer * 10) / 10,
          'K2O_总量': Math.round(kFertilizer * 10) / 10,
        },
        '施肥时期建议': { '基肥': '整地时深施', '分蘖肥': '移栽后7-10天', '穗肥': '幼穗分化初期' },
        '氮肥运筹比例': {
          '基肥': Math.round((ratioParams.base_ratio || 0.50) * 1000) / 10,
          '分蘖肥': Math.round((ratioParams.tiller_ratio || 0.25) * 1000) / 10,
          '穗肥': Math.round((ratioParams.panicle_ratio || 0.25) * 1000) / 10
        }
      };
    } else {
      const [formulaKg, ureaTilleringKg] = this.getWheatFertilizerByYield(targetYield);
      const fr = cropP.formula_ratio;
      const formulaN = formulaKg * (fr[0] / 100);
      const formulaP = formulaKg * (fr[1] / 100);
      const formulaK = formulaKg * (fr[2] / 100);
      recommendation = {
        '肥料用量_公斤每亩': {
          '配方肥_基肥': Math.round(formulaKg * 10) / 10,
          '尿素_拔节肥': Math.round(ureaTilleringKg * 10) / 10,
          '过磷酸钙_基肥': Math.round(formulaP / dp.superphosphate_P_content * 10) / 10,
          '氯化钾_基肥': Math.round(formulaK / dp.potassium_chloride_K_content * 10) / 10,
        },
        '养分用量_公斤每亩': {
          'N_基肥': Math.round(formulaN * 10) / 10,
          'N_拔节肥': Math.round(ureaTilleringKg * dp.urea_N_content * 10) / 10,
          'P2O5_总量': Math.round(formulaP * 10) / 10,
          'K2O_总量': Math.round(formulaK * 10) / 10,
        },
        '施肥时期建议': { '基肥': '播种前整地时深施', '拔节肥': '起身拔节期结合灌水追施' },
        '氮肥运筹比例': {
          '基肥': Math.round((ratioParams.base_ratio || 0.65) * 1000) / 10,
          '拔节肥': Math.round((ratioParams.jointing_ratio || 0.25) * 1000) / 10,
          '孕穗肥': Math.round((ratioParams.booting_ratio || 0.10) * 1000) / 10
        }
      };
    }

    // 9. 通用信息
    Object.assign(recommendation, {
      '计算参数': {
        '目标产量_公斤每亩': targetYield,
        '作物需肥量_N_P_K': [Math.round(nReq * 10) / 10, Math.round(pReq * 10) / 10, Math.round(kReq * 10) / 10],
        '土壤供肥量_N_P_K': [Math.round(nSoil * 10) / 10, Math.round(pSoil * 10) / 10, Math.round(kSoil * 10) / 10],
        '秸秆供肥量_N_P_K': [Math.round(nStraw * 10) / 10, Math.round(pStraw * 10) / 10, Math.round(kStraw * 10) / 10],
        '土壤养分含量_mg_kg': [Math.round(soil_N * 10) / 10, Math.round(soil_P * 10) / 10, Math.round(soil_K * 10) / 10],
        '土壤养分水平': nutrient_levels,
        '数据来源': data_source,
        '肥料利用率_N_P_K': [Math.round(nEff * 1000) / 10, Math.round(pEfficiency * 1000) / 10, Math.round(kEff * 1000) / 10],
        '推荐播期': sowingDate,
        '推荐播期_起始': sowingDateStart,
        '推荐播期_结束': sowingDateEnd,
        '土壤特性': {
          '有机质含量_g/kg': organicMatter,
          'pH值': soilPh,
          '有机质影响系数': soilImpact.organic_matter_impact,
          'pH对磷有效性的影响': soilImpact.ph_impact_on_p
        },
        '使用默认数据': is_default,
        '使用自定义土壤数据': use_custom
      },
      '作物类型': cropType
    });

    return recommendation;
  }
}

// ==================== 辅助函数 ====================
function getNutrientLevel(value, type) {
  const ranges = {
    AN: { 低: 50, 中等: 90, 高: 120 },
    AP: { 低: 5, 中等: 10, 高: 20 },
    AK: { 低: 50, 中等: 100, 高: 150 }
  };
  const r = ranges[type];
  if (!r) return '未知';
  if (value < r['低']) return '低';
  if (value < r['中等']) return '中等';
  if (value < r['高']) return '高';
  return '极高';
}

function generateSimulatedNutrients(lon, lat) {
  const baseAN = 89.2 + (lon - 114) * 2 + (lat - 30) * 3;
  const baseAP = 23.8 + (lon - 114) * 0.5 + (lat - 30) * 0.8;
  const baseAK = 105.0 + (lon - 114) * 1.5 + (lat - 30) * 2;
  const rand = (min, max) => Math.random() * (max - min) + min;
  const AN = Math.max(50, Math.min(150, baseAN + rand(-10, 10)));
  const AP = Math.max(5, Math.min(40, baseAP + rand(-5, 5)));
  const AK = Math.max(60, Math.min(200, baseAK + rand(-20, 20)));
  const makeEntry = (val, layer, desc) => ({
    value: Math.round(val * 10) / 10,
    raw_value: val * 10,
    layer,
    description: desc,
    scale_factor: 10,
    coordinate: { lon, lat },
    pixel_location: { row: -1, col: -1 },
    nutrient_level: getNutrientLevel(val, layer),
    data_source: '模拟数据',
    is_default: true
  });
  return {
    AN: makeEntry(AN, 'AN', '土壤碱解氮含量 (mg/kg)'),
    AP: makeEntry(AP, 'AP', '土壤有效磷含量 (mg/kg)'),
    AK: makeEntry(AK, 'AK', '土壤有效钾含量 (mg/kg)')
  };
}

// ==================== 天气功能 ====================

// ==================== 和风天气 JWT 认证配置 ====================
// 以下信息均从 https://console.qweather.com 控制台获取
const QWEATHER_CONFIG = {
  // 私钥内容（ed25519-private.pem 全文，包含 -----BEGIN/END PRIVATE KEY-----）
  privateKey: `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIIL/Uxau7gN5LYZwE/P+FFc6FZZ/+8fq5WxolE5BPp5a
-----END PRIVATE KEY-----`,
  // 凭据ID（控制台 -> 项目 -> 凭据 -> Key ID）
  keyId: 'T9GYAGPRW3',
  // 项目ID（控制台 -> 项目 -> Project ID）
  projectId: '4JKQKW99BC',
  // API Host（控制台里你专属的域名，如 abcdef.re.qweatherapi.com）
  apiHost: 'mn7h2rh9hq.re.qweatherapi.com'
};

/**
 * 生成和风天气 JWT Token
 * 算法: EdDSA (Ed25519)，使用 Node.js 内置 crypto 模块，无需第三方库
 * Header: { alg: "EdDSA", kid: <凭据ID> }
 * Payload: { sub: <项目ID>, iat: 当前时间-30秒, exp: 当前时间+900秒 }
 */
function generateQWeatherJWT() {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);

  const header  = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: QWEATHER_CONFIG.keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: QWEATHER_CONFIG.projectId,
    iat: now - 30,  // 往前30秒防时钟偏差
    exp: now + 900  // 15分钟有效期
  })).toString('base64url');

  const data      = Buffer.from(`${header}.${payload}`);
  const keyObject = crypto.createPrivateKey(QWEATHER_CONFIG.privateKey);
  const signature = crypto.sign(null, data, keyObject).toString('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * 从和风天气获取7天逐日天气预报（JWT认证）
 * API文档: https://dev.qweather.com/docs/api/weather/weather-daily-forecast/
 */
async function getQWeatherForecast(lat, lon) {
  const { privateKey, keyId, projectId, apiHost } = QWEATHER_CONFIG;
  if (!privateKey || privateKey.includes('请填入') || !keyId || keyId.includes('请填入')) {
    return { success: false, error: '未完整配置和风天气JWT参数' };
  }
  try {
    const token = generateQWeatherJWT();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept-Encoding': 'gzip, deflate',
      'User-Agent': 'Mozilla/5.0'
    };
    const baseUrl = `https://${apiHost}`;
    const nowUrl      = `${baseUrl}/v7/weather/now?location=${lon},${lat}&lang=zh`;
    const forecastUrl = `${baseUrl}/v7/weather/7d?location=${lon},${lat}&lang=zh`;

    const [nowData, forecastData] = await Promise.all([
      httpsGetDecompress(nowUrl, headers),
      httpsGetDecompress(forecastUrl, headers)
    ]);

    console.log('[QWeather] nowData:', JSON.stringify(nowData).slice(0, 300));
    console.log('[QWeather] forecastData:', JSON.stringify(forecastData).slice(0, 300));

    // 和风天气新版响应结构: { code: 200, data: { code: "200", now: {...} } } 或旧版 { code: "200", now: {...} }
    const nowCode      = String(nowData.code      || (nowData.data && nowData.data.code)      || '');
    const forecastCode = String(forecastData.code || (forecastData.data && forecastData.data.code) || '');

    if (nowCode !== '200') {
      const detail = nowData.error ? `${nowData.error.status} - ${nowData.error.detail}` : `code=${nowCode}`;
      return { success: false, error: `和风天气实况API错误: ${detail}` };
    }
    if (forecastCode !== '200') {
      const detail = forecastData.error ? `${forecastData.error.status} - ${forecastData.error.detail}` : `code=${forecastCode}`;
      return { success: false, error: `和风天气预报API错误: ${detail}` };
    }

    // 兼容新旧两种响应结构
    const now   = nowData.now      || (nowData.data      && nowData.data.now)      || {};
    const daily = forecastData.daily || (forecastData.data && forecastData.data.daily) || [];

    const current = {
      temperature:  parseFloat(now.temp)      || null,
      weather_desc: now.text                  || convertQWeatherCode(now.icon),
      weather_code: now.icon,
      humidity:     now.humidity,
      wind_dir:     now.windDir,
      wind_scale:   now.windScale,
      wind_speed:   now.windSpeed,
      feels_like:   now.feelsLike,
      pressure:     now.pressure,
      vis:          now.vis,
      obs_time:     now.obsTime
    };

    const dailyForecasts = daily.map(d => ({
      date:               d.fxDate,
      max_temp:           parseFloat(d.tempMax)  || null,
      min_temp:           parseFloat(d.tempMin)  || null,
      weather_desc:       d.textDay              || convertQWeatherCode(d.iconDay),
      weather_desc_night: d.textNight            || convertQWeatherCode(d.iconNight),
      weather_code:       d.iconDay,
      weather_code_night: d.iconNight,
      humidity:           d.humidity,
      precip:             d.precip,
      pop:                d.pop,
      uv_index:           d.uvIndex,
      wind_dir_day:       d.windDirDay,
      wind_scale_day:     d.windScaleDay,
      wind_dir_night:     d.windDirNight,
      wind_scale_night:   d.windScaleNight,
      sunrise:            d.sunrise,
      sunset:             d.sunset
    }));

    return {
      success:     true,
      source:      'QWeather',
      current,
      daily:       dailyForecasts,
      location:    { latitude: lat, longitude: lon },
      update_time: forecastData.updateTime || (forecastData.data && forecastData.data.updateTime)
    };
  } catch (e) {
    return { success: false, error: `和风天气请求失败: ${e.message}` };
  }
}

/**
 * 和风天气天气状况代码转中文描述
 * 参考: https://dev.qweather.com/docs/resource/icons/
 */
function convertQWeatherCode(code) {
  const codeNum = parseInt(code, 10);
  const qwMap = {
    100: '晴', 101: '多云', 102: '少云', 103: '晴间多云', 104: '阴',
    150: '晴', 151: '多云', 152: '少云', 153: '晴间多云',
    200: '有风', 201: '平静', 202: '微风', 203: '和风', 204: '清风',
    205: '强风', 206: '疾风', 207: '大风', 208: '烈风', 209: '风暴',
    210: '狂爆风', 211: '飓风', 212: '龙卷风', 213: '热带风暴',
    300: '阵雨', 301: '强阵雨', 302: '雷阵雨', 303: '强雷阵雨',
    304: '雷阵雨伴有冰雹', 305: '小雨', 306: '中雨', 307: '大雨',
    308: '极端降雨', 309: '毛毛雨', 310: '暴雨', 311: '大暴雨',
    312: '特大暴雨', 313: '冻雨', 314: '小到中雨', 315: '中到大雨',
    316: '大到暴雨', 317: '暴雨到大暴雨', 318: '大暴雨到特大暴雨',
    350: '阵雨', 351: '强阵雨', 399: '雨',
    400: '小雪', 401: '中雪', 402: '大雪', 403: '暴雪',
    404: '雨夹雪', 405: '雨雪天气', 406: '阵雨夹雪', 407: '阵雪',
    408: '小到中雪', 409: '中到大雪', 410: '大到暴雪',
    456: '阵雨夹雪', 457: '阵雪', 499: '雪',
    500: '薄雾', 501: '雾', 502: '霾', 503: '扬沙', 504: '浮尘',
    507: '沙尘暴', 508: '强沙尘暴', 509: '浓雾', 510: '强浓雾',
    511: '中度霾', 512: '重度霾', 513: '严重霾', 514: '大雾', 515: '强大雾',
    900: '热', 901: '冷', 999: '未知'
  };
  return qwMap[codeNum] || '未知';
}



function convertWeatherCode(code) {
  const weatherMap = {
    0: '晴', 1: '晴', 2: '多云', 3: '阴',
    45: '雾', 48: '雾',
    51: '小雨', 53: '小雨', 55: '中雨',
    61: '小雨', 63: '中雨', 65: '大雨',
    71: '小雪', 73: '中雪', 75: '大雪', 77: '雪',
    80: '阵雨', 81: '阵雨', 82: '暴雨',
    85: '阵雪', 86: '阵雪',
    95: '雷阵雨', 96: '雷阵雨', 99: '雷阵雨'
  };
  return weatherMap[code] || '未知';
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject).setTimeout(10000, function() { this.abort(); reject(new Error('请求超时')); });
  });
}

/**
 * 支持 gzip/deflate 解压的 HTTPS GET（和风天气等返回压缩数据的接口专用）
 */
function httpsGetDecompress(url, extraHeaders = {}) {
  const zlib = require('zlib');
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'Accept-Encoding': 'gzip, deflate',
        'User-Agent': 'Mozilla/5.0',
        ...extraHeaders
      }
    };
    lib.get(url, options, (res) => {
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (encoding === 'gzip') {
        stream = res.pipe(zlib.createGunzip());
      } else if (encoding === 'deflate') {
        stream = res.pipe(zlib.createInflate());
      }
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        try {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON解析失败: ${e.message}`));
        }
      });
      stream.on('error', reject);
    }).on('error', reject).setTimeout(10000, function() { this.destroy(); reject(new Error('请求超时')); });
  });
}

async function getWeatherForecast(latitude, longitude, forecastDays = 7) {
  const params = new URLSearchParams({
    latitude, longitude,
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'auto',
    forecast_days: Math.min(forecastDays, 16)
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  try {
    const data = await httpsGet(url);
    const current = data.current || {};
    const daily = data.daily || {};
    const dates = daily.time || [];
    const maxTemps = daily.temperature_2m_max || [];
    const minTemps = daily.temperature_2m_min || [];
    const weatherCodes = daily.weather_code || [];

    const dailyForecasts = [];
    for (let i = 0; i < Math.min(forecastDays, dates.length); i++) {
      dailyForecasts.push({
        date: dates[i],
        max_temp: maxTemps[i] ?? null,
        min_temp: minTemps[i] ?? null,
        weather_code: weatherCodes[i] ?? null,
        weather_desc: convertWeatherCode(weatherCodes[i])
      });
    }

    return {
      success: true,
      current: {
        temperature: current.temperature_2m,
        weather_code: current.weather_code,
        weather_desc: convertWeatherCode(current.weather_code)
      },
      daily: dailyForecasts,
      location: { latitude, longitude },
      raw_data: data
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function generateSimulatedWeather(city) {
  const conditions = ['晴', '多云', '阴', '小雨', '中雨'];
  const weather = conditions[Math.floor(Math.random() * conditions.length)];
  const temp = 15 + Math.floor(Math.random() * 20);
  const now = new Date().toISOString().slice(0, 10);
  return {
    status: '1',
    lives: [{ city, weather, temperature: String(temp), humidity: String(40 + Math.floor(Math.random() * 50)), winddirection: '北', windpower: String(Math.floor(Math.random() * 4)) }],
    forecasts: [{ city, casts: [{ date: now, dayweather: weather, nightweather: '多云', daytemp: String(temp + 5), nighttemp: String(temp - 5) }] }]
  };
}

async function getWeatherByCity(city, lon = null, lat = null) {
  const coords = CITY_COORDS[city] || { lon: 114.305, lat: 30.592 };
  const useLon = lon || coords.lon;
  const useLat = lat || coords.lat;

  // ---- 优先使用和风天气（JWT认证，需配置 QWEATHER_CONFIG）----
  if (QWEATHER_CONFIG.keyId && !QWEATHER_CONFIG.keyId.includes('请填入')) {
    const qResult = await getQWeatherForecast(useLat, useLon);
    if (qResult && qResult.success) {
      const weatherData = {
        status: '1',
        lives: [{
          city,
          weather: qResult.current.weather_desc,
          temperature: String(Math.round(qResult.current.temperature || 0)),
          humidity: qResult.current.humidity || '--',
          winddirection: qResult.current.wind_dir || '未知',
          windpower: qResult.current.wind_scale || '0',
          windspeed: qResult.current.wind_speed || '--',
          feelslike: qResult.current.feels_like || '--',
          pressure: qResult.current.pressure || '--',
          vis: qResult.current.vis || '--',
          reporttime: qResult.current.obs_time || new Date().toISOString().replace('T', ' ').slice(0, 19)
        }],
        forecasts: [{
          city,
          casts: qResult.daily.map(d => ({
            date: d.date,
            dayweather: d.weather_desc,
            nightweather: d.weather_desc_night,
            daytemp: d.max_temp != null ? String(Math.round(d.max_temp)) : '--',
            nighttemp: d.min_temp != null ? String(Math.round(d.min_temp)) : '--',
            weather_code: d.weather_code,
            weather_code_night: d.weather_code_night,
            humidity: d.humidity,
            precip: d.precip,
            pop: d.pop,
            uv_index: d.uv_index,
            wind_dir_day: d.wind_dir_day,
            wind_scale_day: d.wind_scale_day,
            wind_dir_night: d.wind_dir_night,
            wind_scale_night: d.wind_scale_night,
            sunrise: d.sunrise,
            sunset: d.sunset
          }))
        }],
        qweather_data: qResult,
        forecast_days: qResult.daily.length,
        update_time: qResult.update_time
      };
      return { success: true, data: weatherData, is_simulated: false, city, data_source: '和风天气' };
    }
    console.warn('[Weather] 和风天气获取失败，回退到 Open-Meteo:', qResult.error);
  }

  // ---- 回退：Open-Meteo（免费，无需 API Key）----
  const result = await getWeatherForecast(useLat, useLon);
  if (result && result.success) {
    const weatherData = {
      status: '1',
      lives: [{
        city,
        weather: result.current.weather_desc,
        temperature: String(Math.round(result.current.temperature)),
        humidity: '60',
        winddirection: '未知',
        windpower: '0',
        reporttime: new Date().toISOString().replace('T', ' ').slice(0, 19)
      }],
      forecasts: [{
        city,
        casts: result.daily.map(d => ({
          date: d.date,
          dayweather: d.weather_desc,
          nightweather: d.weather_desc,
          daytemp: d.max_temp != null ? String(Math.round(d.max_temp)) : '--',
          nighttemp: d.min_temp != null ? String(Math.round(d.min_temp)) : '--',
          weather_code: d.weather_code
        }))
      }],
      open_meteo_data: result.raw_data,
      forecast_days: result.daily.length
    };
    return { success: true, data: weatherData, is_simulated: false, city, data_source: 'Open-Meteo' };
  }

  return { success: true, data: generateSimulatedWeather(city), is_simulated: true, city, data_source: '模拟数据' };
}

function calculateGrowthStage(cropType, sowingDate) {
  if (!sowingDate) return { stage: '播种期', description: '请提供播种日期' };
  try {
    const sowing = new Date(sowingDate);
    const days = Math.round((Date.now() - sowing.getTime()) / 86400000);
    if (cropType === '水稻') {
      if (days < 0) return { stage: '播种前', description: '尚未播种' };
      if (days < 7) return { stage: '播种期', description: '播种至出苗' };
      if (days < 21) return { stage: '幼苗期', description: '秧苗生长' };
      if (days < 45) return { stage: '分蘖期', description: '分蘖生长' };
      if (days < 65) return { stage: '拔节期', description: '茎秆拔节' };
      if (days < 85) return { stage: '孕穗期', description: '穗分化' };
      if (days < 105) return { stage: '抽穗扬花期', description: '抽穗开花' };
      return { stage: '成熟期', description: '灌浆成熟' };
    } else {
      if (days < 0) return { stage: '播种前', description: '尚未播种' };
      if (days < 15) return { stage: '播种期', description: '播种出苗' };
      if (days < 60) return { stage: '分蘖期', description: '分蘖生长' };
      if (days < 120) return { stage: '越冬期', description: '冬季休眠' };
      if (days < 150) return { stage: '返青期', description: '春季返青' };
      if (days < 180) return { stage: '拔节期', description: '茎秆拔节' };
      if (days < 210) return { stage: '孕穗期', description: '穗分化' };
      if (days < 240) return { stage: '抽穗扬花期', description: '抽穗开花' };
      return { stage: '成熟期', description: '灌浆成熟' };
    }
  } catch (e) {
    return { stage: '未知', description: '日期解析错误' };
  }
}

/**
 * 改进的降雨风险分析函数
 * 综合利用降雨量(precip)、降雨概率(pop)和天气预报描述
 */
function analyzeRainRisk(weather, dailyForecast, qweatherData) {
  const result = { level: 'low', advice: '适宜施肥', details: [] };
  
  // 1. 从和风天气数据中获取精确的降雨信息
  if (qweatherData && qweatherData.current) {
    const current = qweatherData.current;
    const currentPrecip = parseFloat(current.precip) || 0;
    const currentPop = parseFloat(current.pop) || 0;
    
    // 当前降雨量判定
    if (currentPrecip > 10) {
      result.level = 'high';
      result.details.push(`当前降雨量${currentPrecip}mm，属于大雨级别`);
      result.advice = '当前降雨量较大，严禁施肥作业';
    } else if (currentPrecip > 5) {
      if (result.level !== 'high') result.level = 'medium';
      result.details.push(`当前降雨量${currentPrecip}mm，属于中雨级别`);
      result.advice = '当前有中雨，不建议撒施肥料';
    } else if (currentPrecip > 0.1) {
      if (result.level === 'low') result.level = 'low';
      result.details.push(`当前降雨量${currentPrecip}mm，属于小雨级别`);
      result.advice = '当前有小雨，建议深施或雨后施肥';
    }
    
    // 当前降雨概率判定
    if (currentPop > 70 && result.level !== 'high') {
      result.level = 'medium';
      result.details.push(`当前降雨概率${currentPop}%`);
      if (result.level === 'low') result.advice = '降雨概率较高，建议关注天气变化';
    }
  }
  
  // 2. 分析未来24-72小时降雨预报
  if (dailyForecast && dailyForecast.length > 0) {
    // 未来24小时（今天）
    const today = dailyForecast[0];
    if (today) {
      const todayPop = parseFloat(today.pop) || 0;
      const todayPrecip = parseFloat(today.precip) || 0;
      
      if (todayPop > 80) {
        if (result.level !== 'high') result.level = 'medium';
        result.details.push(`今日降雨概率${todayPop}%`);
        result.advice = '今日降雨概率很高，建议暂缓施肥或深施覆土';
      } else if (todayPop > 60) {
        if (result.level === 'low') result.level = 'low';
        result.details.push(`今日降雨概率${todayPop}%`);
      }
      
      // 预报降雨量
      if (todayPrecip > 15) {
        result.level = 'high';
        result.details.push(`今日预报降雨量${todayPrecip}mm`);
        result.advice = '今日预报有大雨，不建议施肥';
      }
    }
    
    // 未来48-72小时（明后天）
    for (let i = 1; i < Math.min(3, dailyForecast.length); i++) {
      const day = dailyForecast[i];
      if (day) {
        const dayPop = parseFloat(day.pop) || 0;
        if (dayPop > 70) {
          result.details.push(`${i === 1 ? '明天' : '后天'}降雨概率${dayPop}%`);
          if (result.level === 'low') {
            result.advice = '未来1-2天可能有降雨，如需施肥建议深施覆土';
          }
        }
      }
    }
  }
  
  // 3. 天气描述关键词判定（作为补充）
  const weatherDesc = (weather && weather.weather_desc) ? weather.weather_desc : '';
  const rainKeywords = {
    '暴雨': { level: 'high', precip: '>25' },
    '大暴雨': { level: 'high', precip: '>50' },
    '特大暴雨': { level: 'high', precip: '>100' },
    '大雨': { level: 'high', precip: '10-25' },
    '中雨': { level: 'medium', precip: '5-10' },
    '小雨': { level: 'low', precip: '0.1-5' },
    '雷阵雨': { level: 'medium', precip: 'variable' },
    '阵雨': { level: 'low', precip: 'variable' },
    '冻雨': { level: 'high', precip: 'variable' },
    '雨夹雪': { level: 'medium', precip: 'variable' }
  };
  
  for (const [kw, info] of Object.entries(rainKeywords)) {
    if (weatherDesc.includes(kw)) {
      result.details.push(`天气描述：${kw}`);
      if (info.level === 'high' && result.level !== 'high') {
        result.level = 'high';
        result.advice = `${kw}天气，严禁施肥作业`;
      } else if (info.level === 'medium' && result.level === 'low') {
        result.level = 'medium';
        result.advice = `${kw}天气，建议深施或暂缓施肥`;
      }
      break;
    }
  }
  
  return result;
}

/**
 * 改进的施肥适宜性综合分析函数
 */
function analyzeWeather(weatherData) {
  if (!weatherData || !weatherData.lives) {
    return { suitable: true, warning: null, rain_risk: '低', warnings: [], alerts: [], daily_forecast: [] };
  }
  try {
    const live = (weatherData.lives || [{}])[0] || {};
    const weather = live.weather || '未知';
    const temp = parseInt(live.temperature) || 20;
    const humidity = parseInt(live.humidity) || 60;
    const windPower = live.windpower || '0';
    const windDir = live.winddirection || '未知';

    // 构建完整的每日预报数据（包含pop和precip）
    const dailyForecast = [];
    const forecasts = weatherData.forecasts || [];
    if (forecasts.length > 0) {
      for (const cast of (forecasts[0].casts || []).slice(0, 7)) {
        dailyForecast.push({
          date: cast.date || '',
          dayweather: cast.dayweather || '未知',
          nightweather: cast.nightweather || '未知',
          daytemp: cast.daytemp || '--',
          nighttemp: cast.nighttemp || '--',
          weather_code: cast.weather_code || 0,
          pop: cast.pop || null,           // 降雨概率
          precip: cast.precip || null,     // 降雨量
          humidity: cast.humidity || null,
          uv_index: cast.uv_index || null
        });
      }
    }
    if (!dailyForecast.length && weatherData.open_meteo_data) {
      const daily = weatherData.open_meteo_data.daily || {};
      const dates = daily.time || [];
      for (let i = 0; i < Math.min(dates.length, 7); i++) {
        dailyForecast.push({
          date: dates[i] || '',
          dayweather: convertWeatherCode(daily.weather_code?.[i]),
          nightweather: convertWeatherCode(daily.weather_code?.[i]),
          daytemp: daily.temperature_2m_max?.[i] != null ? String(Math.round(daily.temperature_2m_max[i])) : '--',
          nighttemp: daily.temperature_2m_min?.[i] != null ? String(Math.round(daily.temperature_2m_min[i])) : '--',
          weather_code: daily.weather_code?.[i] || 0,
          pop: null,
          precip: null
        });
      }
    }

    const warnings = [], alerts = [];
    let warningLevel = 'low';

    // ===== 改进的降雨风险分析 =====
    const qweatherData = weatherData.qweather_data || null;
    const currentWeatherObj = { weather_desc: weather };
    const rainAnalysis = analyzeRainRisk(currentWeatherObj, dailyForecast, qweatherData);
    
    // 根据降雨分析结果生成预警
    if (rainAnalysis.level === 'high') {
      warningLevel = 'high';
      warnings.push(`🌧️ 降雨预警：${rainAnalysis.advice}`);
      alerts.push({
        type: 'rain',
        level: 'high',
        title: '降雨高风险预警',
        message: rainAnalysis.advice,
        icon: 'fa-cloud-showers-heavy',
        details: rainAnalysis.details
      });
    } else if (rainAnalysis.level === 'medium') {
      if (warningLevel !== 'high') warningLevel = 'medium';
      warnings.push(`🌧️ 降雨提醒：${rainAnalysis.advice}`);
      alerts.push({
        type: 'rain',
        level: 'medium',
        title: '降雨风险提醒',
        message: rainAnalysis.advice,
        icon: 'fa-cloud-rain',
        details: rainAnalysis.details
      });
    } else if (rainAnalysis.details.length > 0) {
      // 低风险但有降雨相关信息
      alerts.push({
        type: 'rain',
        level: 'low',
        title: '降雨信息',
        message: rainAnalysis.advice,
        icon: 'fa-cloud',
        details: rainAnalysis.details
      });
    }

    if (temp > 35) {
      warnings.push('🔥 高温预警：气温超过35°C，肥料易挥发损失，建议傍晚或清晨施肥');
      alerts.push({ type: 'temperature', level: 'high', title: '高温预警', message: `当前气温${temp}°C，超过35°C高温阈值。建议傍晚或清晨施肥，或深施覆土。`, icon: 'fa-temperature-high' });
      warningLevel = 'high';
    } else if (temp > 30) {
      warnings.push('🌡️ 温度偏高：建议避开中午高温时段施肥');
      alerts.push({ type: 'temperature', level: 'medium', title: '温度偏高提醒', message: `当前气温${temp}°C，建议早晨或傍晚施肥。`, icon: 'fa-temperature-high' });
      if (warningLevel !== 'high') warningLevel = 'medium';
    }

    if (temp < 5) {
      warnings.push('❄️ 低温预警：气温低于5°C，肥料效果受限，建议气温回升后施肥');
      alerts.push({ type: 'temperature', level: 'high', title: '低温预警', message: `当前气温${temp}°C，低温条件下土壤微生物活性低，效果受限。`, icon: 'fa-snowflake' });
      warningLevel = 'high';
    } else if (temp < 10) {
      warnings.push('🥶 温度偏低：肥料效果可能受影响');
      alerts.push({ type: 'temperature', level: 'medium', title: '低温提醒', message: `当前气温${temp}°C，可适当增加有机肥用量。`, icon: 'fa-temperature-low' });
      if (warningLevel !== 'high') warningLevel = 'medium';
    }

    if (humidity > 85) {
      warnings.push('💧 湿度高：空气湿度大，注意肥料结块，建议现配现用');
      alerts.push({ type: 'humidity', level: 'medium', title: '高湿提醒', message: `空气湿度${humidity}%，肥料易结块。`, icon: 'fa-tint' });
    } else if (humidity < 40) {
      warnings.push('☀️ 干燥：空气干燥，施肥后建议适量灌溉');
      alerts.push({ type: 'humidity', level: 'low', title: '干燥提醒', message: `空气湿度${humidity}%，施肥后建议适量灌溉。`, icon: 'fa-sun' });
    }

    try {
      const windLevel = parseInt(windPower) || 0;
      if (windLevel >= 5) {
        warnings.push('💨 大风预警：风力较大，不建议撒施肥料');
        alerts.push({ type: 'wind', level: 'high', title: '大风预警', message: `当前风力${windLevel}级，建议深施或等风力减小。`, icon: 'fa-wind' });
        warningLevel = 'high';
      } else if (windLevel >= 3) {
        alerts.push({ type: 'wind', level: 'low', title: '风力提醒', message: `当前风力${windLevel}级，撒施时注意风向。`, icon: 'fa-wind' });
      }
    } catch (e) { /* ignore */ }

    const rainRisk = alerts.some(a => a.type === 'rain' && a.level === 'high') ? '高' :
      alerts.some(a => a.type === 'rain') ? '中' : '低';
    const tempRisk = alerts.some(a => a.type === 'temperature' && a.level === 'high') ? '高' :
      alerts.some(a => a.type === 'temperature') ? '中' : '低';

    return {
      suitable: warnings.length === 0,
      warning: warnings.length ? warnings.join('；') : null,
      warnings, alerts, warning_level: warningLevel,
      current_weather: weather, temperature: temp, humidity,
      wind_direction: windDir, wind_power: windPower,
      rain_risk: rainRisk, temperature_risk: tempRisk,
      daily_forecast: dailyForecast
    };
  } catch (e) {
    return { suitable: true, warning: null, warnings: [], alerts: [], error: e.message };
  }
}

function generateTimingAdvice(cropType, growthStage, weather) {
  const stage = growthStage.stage || '';
  const suitable = weather.suitable !== false;
  const advice = {
    can_fertilize: suitable && !['成熟期', '收获期'].includes(stage),
    best_timing: [],
    general_advice: []
  };
  if (cropType === '水稻') {
    if (stage === '播种期') { advice.best_timing.push('基肥：播种前结合整地施入'); advice.general_advice.push('基肥占总施肥量40-50%'); }
    else if (stage === '分蘖期') advice.best_timing.push('分蘖肥：移栽后7-10天施用');
    else if (['拔节期', '孕穗期'].includes(stage)) advice.best_timing.push('穗肥：幼穗分化初期施用');
    else if (stage === '成熟期') { advice.can_fertilize = false; advice.general_advice.push('已进入成熟期，不再建议施肥'); }
  } else {
    if (stage === '播种期') { advice.best_timing.push('基肥：播种前结合整地施入'); advice.general_advice.push('基肥占总施肥量60-70%'); }
    else if (stage === '越冬期') { advice.can_fertilize = false; advice.general_advice.push('冬季低温，不建议施肥'); }
    else if (stage === '返青期') advice.best_timing.push('返青肥：春季返青后施用');
    else if (stage === '拔节期') advice.best_timing.push('拔节肥：起身期施用');
    else if (stage === '成熟期') advice.can_fertilize = false;
  }
  if (weather.warning) {
    advice.weather_warning = weather.warning;
    if (weather.warning.includes('降水')) advice.general_advice.push('建议深施或水肥一体化，避免雨前撒施');
    if (weather.warning.includes('高温')) advice.general_advice.push('建议傍晚施肥，减少挥发');
  }
  return advice;
}

// ==================== 高德地图代理函数 ====================
function amapProxyRequest(method, url, params) {
  return new Promise((resolve, reject) => {
    const queryStr = new URLSearchParams(params).toString();
    const fullUrl = method === 'GET' ? `${url}?${queryStr}` : url;
    https.get(fullUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

// ==================== 全局模型实例 ====================
const model = new CropRotationFertilizerModel();

// ==================== 数据库初始化 ====================
const db = new Database();
db.init();
console.log('数据库初始化完成');

// ==================== 路由定义 ====================

// 主页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'fertilizer-recommendation',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    geotiff_processor: '不可用（使用模拟数据）',
    endpoints: {
      '/': '主页',
      '/health': '健康检查',
      '/calculate': '计算施肥方案',
      '/test_geotiff': '测试土壤数据',
      '/api/test': 'API测试'
    }
  });
});

// API测试
app.all('/api/test', (req, res) => {
  res.json({
    success: true,
    message: `API测试成功 (${req.method})`,
    received_data: req.body || {},
    timestamp: new Date().toISOString()
  });
});

// 测试土壤数据
app.get('/test_geotiff', async (req, res) => {
  const lon = parseFloat(req.query.lon) || 114.305;
  const lat = parseFloat(req.query.lat) || 30.592;
  if (!(lon >= 110 && lon <= 122 && lat >= 28 && lat <= 33)) {
    return res.status(400).json({ success: false, error: `坐标超出范围：经度110-122, 纬度28-33, 当前: ${lon}, ${lat}` });
  }
  
  // 优先从GeoTIFF获取数据
  const geoTiffData = getSoilNutrientsFromGeoTIFF(lon, lat);
  
  if (geoTiffData.has_valid_data) {
    // 使用GeoTIFF数据
    const nutrients = {
      AN: geoTiffData.AN || generateSimulatedNutrients(lon, lat).AN,
      AP: geoTiffData.AP || generateSimulatedNutrients(lon, lat).AP,
      AK: geoTiffData.AK || generateSimulatedNutrients(lon, lat).AK
    };
    
    // 更新数据来源标记
    if (nutrients.AN) nutrients.AN.data_source = geoTiffData.AN ? 'GeoTIFF' : '模拟数据';
    if (nutrients.AP) nutrients.AP.data_source = geoTiffData.AP ? 'GeoTIFF' : '模拟数据';
    if (nutrients.AK) nutrients.AK.data_source = geoTiffData.AK ? 'GeoTIFF' : '模拟数据';
    
    res.json({
      success: true,
      coordinate: { lon, lat },
      nutrients,
      is_default_data: false,
      geotiff_loaded: geotiffCache.metadata?.loaded || false,
      message: '从GeoTIFF文件读取土壤数据成功'
    });
  } else {
    // 回退到模拟数据
    const nutrients = generateSimulatedNutrients(lon, lat);
    res.json({
      success: true,
      coordinate: { lon, lat },
      nutrients,
      is_default_data: true,
      geotiff_loaded: geotiffCache.metadata?.loaded || false,
      message: 'GeoTIFF数据不可用，使用模拟数据'
    });
  }
});

// 计算施肥方案
app.post('/calculate', (req, res) => {
  try {
    const data = req.body;
    if (!data) return res.status(400).json({ error: '未收到数据' });

    const cropType = data.crop;
    let targetYield = data.yield;
    const sowingDate = data.date;
    let lon = data.lon;
    let lat = data.lat;
    const customSoilData = data.custom_soil_data || {};
    const useCustomSoil = data.use_custom_soil || false;

    if (!cropType || !['水稻', '小麦'].includes(cropType))
      return res.status(400).json({ error: '作物类型必须是"水稻"或"小麦"' });
    if (!targetYield)
      return res.status(400).json({ error: '缺少目标产量参数' });
    if (sowingDate == null && (lon == null || lat == null))
      return res.status(400).json({ error: '缺少播种日期参数或经纬度参数' });

    try {
      targetYield = parseFloat(targetYield);
      lon = parseFloat(lon);
      lat = parseFloat(lat);
      for (const key of ['N', 'P', 'K']) {
        if (key in customSoilData && customSoilData[key] != null) {
          customSoilData[key] = parseFloat(customSoilData[key]);
          if (isNaN(customSoilData[key])) customSoilData[key] = null;
        }
      }
    } catch (e) {
      return res.status(400).json({ error: '产量和经纬度必须是数字' });
    }

    if (targetYield <= 0 || targetYield > 1000)
      return res.status(400).json({ error: '产量必须在1-1000之间' });
    if (!(lon >= 110 && lon <= 122 && lat >= 28 && lat <= 33))
      return res.status(400).json({ error: '经纬度超出长江中下游地区范围' });

    if (customSoilData.N != null && (customSoilData.N < 0 || customSoilData.N > 300))
      return res.status(400).json({ error: '碱解氮(N)值必须在0-300之间' });
    if (customSoilData.P != null && (customSoilData.P < 0 || customSoilData.P > 100))
      return res.status(400).json({ error: '有效磷(P)值必须在0-100之间' });
    if (customSoilData.K != null && (customSoilData.K < 0 || customSoilData.K > 500))
      return res.status(400).json({ error: '有效钾(K)值必须在0-500之间' });

    const params = {
      target_yield: targetYield,
      sowing_date: sowingDate,
      lon, lat,
      organic_matter: 20.7,
      soil_ph: 8.18,
      straw_return_amount: cropType === '水稻' ? 600 : 700,
      temperature_forecast: cropType === '水稻' ? 22.5 : 12.0
    };
    if (customSoilData && useCustomSoil) {
      params.custom_soil_data = customSoilData;
      params.use_custom_soil = true;
    }

    const internalCrop = cropType === '水稻' ? 'rice' : 'wheat';
    const strawSourceType = internalCrop === 'rice' ? 'wheat' : 'rice';
    const recommendation = model.calculateFertilizerRecommendation(params, internalCrop, strawSourceType);

    const fertilizerUsage = recommendation['肥料用量_公斤每亩'];
    const stageAdvice = recommendation['施肥时期建议'];
    const nutrientUsage = recommendation['养分用量_公斤每亩'] || {};
    const calcParams = recommendation['计算参数'];
    const soilNutrients = calcParams['土壤养分含量_mg_kg'];
    const nutrientLevels = calcParams['土壤养分水平'];
    const dataSource = calcParams['数据来源'];
    const useCustom = calcParams['使用自定义土壤数据'] || false;

    const guidance = [];
    if (cropType === '水稻') {
      guidance.push('1. 基肥占总氮肥的50%左右，磷钾肥全部作基肥');
      guidance.push('2. 分蘖肥在移栽后7-10天施用，促进分蘖');
      guidance.push('3. 穗肥在幼穗分化初期施用，促进大穗形成');
      const anLevel = nutrientLevels.AN || '未知';
      if (['低', '极低'].includes(anLevel)) guidance.push('4. 土壤碱解氮含量较低，建议氮肥用量增加10-15%');
      else if (['高', '极高'].includes(anLevel)) guidance.push('4. 土壤碱解氮含量较高，建议氮肥用量减少10%');
      if (['低', '极低'].includes(nutrientLevels.AP)) guidance.push('5. 土壤有效磷含量较低，建议磷肥用量增加15-20%');
      if (['低', '极低'].includes(nutrientLevels.AK)) guidance.push('6. 土壤有效钾含量较低，建议钾肥用量增加10-15%');
      guidance.push('7. 注意浅水施肥，提高肥料利用率');
    } else {
      guidance.push('1. 基肥占总氮肥的60%左右，磷钾肥全部作基肥');
      guidance.push('2. 拔节肥在起身拔节期施用，促进茎秆健壮');
      guidance.push('3. 孕穗肥在孕穗期施用，促进穗粒发育');
      const anLevel = nutrientLevels.AN || '未知';
      if (['低', '极低'].includes(anLevel)) guidance.push('4. 土壤碱解氮含量较低，建议分蘖期追肥量增加20%');
      else if (['高', '极高'].includes(anLevel)) guidance.push('4. 土壤碱解氮含量较高，可适当减少基肥氮用量');
      if (['低', '极低'].includes(nutrientLevels.AP)) guidance.push('5. 土壤有效磷严重不足，建议磷肥全部作基肥，并适当深施');
      if (['低', '极低'].includes(nutrientLevels.AK)) guidance.push('6. 土壤有效钾含量低，建议钾肥分基肥和拔节期两次施用');
      guidance.push('7. 注意深施覆土，减少肥料损失');
    }
    if (useCustom) guidance.push('8. 注意：当前使用了手动输入的土壤养分数据');
    else if (calcParams['使用默认数据']) guidance.push('8. 注意：当前使用默认土壤数据，建议连接土壤数据库获取精确数据');

    const response = {
      fertilizer_usage: fertilizerUsage,
      stage_advice: stageAdvice,
      nutrient_usage: nutrientUsage,
      calc_params: {
        target_yield: calcParams['目标产量_公斤每亩'],
        nutrient_demand: calcParams['作物需肥量_N_P_K'],
        soil_supply: calcParams['土壤供肥量_N_P_K'],
        straw_supply: calcParams['秸秆供肥量_N_P_K'],
        soil_nutrients: soilNutrients,
        nutrient_levels: nutrientLevels,
        data_source: dataSource,
        fertilizer_efficiency: calcParams['肥料利用率_N_P_K'],
        recommended_sowing_date: calcParams['推荐播期'],
        recommended_sowing_date_start: calcParams['推荐播期_起始'],
        recommended_sowing_date_end: calcParams['推荐播期_结束'],
        is_default_data: calcParams['使用默认数据'] || false,
        use_custom_soil: useCustom
      },
      guidance
    };

    // 保存到数据库
    try {
      let userSession = req.cookies.fertilizer_session;
      if (!userSession) userSession = uuidv4();

      const calcData = {
        crop_type: cropType,
        target_yield: targetYield,
        longitude: lon,
        latitude: lat,
        sowing_date: sowingDate,
        soil_n: customSoilData.N ?? null,
        soil_p: customSoilData.P ?? null,
        soil_k: customSoilData.K ?? null,
        use_custom_soil: useCustomSoil ? 1 : 0,
        organic_matter: 20.7,
        soil_ph: 8.18,
        straw_return_amount: cropType === '水稻' ? 600 : 700,
        fertilizer_recommendation: JSON.stringify({
          fertilizer_usage: fertilizerUsage,
          stage_advice: stageAdvice,
          nutrient_usage: nutrientUsage,
          calc_params: calcParams,
          guidance
        }),
        user_session: userSession,
        user_ip: req.ip,
        user_agent: req.headers['user-agent'] || '',
        data_source: 'online',
        is_default_data: calcParams['使用默认数据'] ? 1 : 0
      };
      const recordId = db.saveCalculation(calcData);
      if (recordId) response.record_id = recordId;

      res.cookie('fertilizer_session', userSession, { maxAge: 30 * 24 * 3600 * 1000 });
    } catch (dbErr) {
      console.warn('数据库保存错误（不影响计算结果）:', dbErr.message);
    }

    res.json(response);
  } catch (e) {
    console.error('计算错误:', e);
    res.status(500).json({ error: `计算失败: ${e.message}` });
  }
});

// 模拟计算端点
app.post('/api/simulate', (req, res) => {
  try {
    const data = req.body || {};
    const cropType = data.crop || '水稻';
    const targetYield = parseFloat(data.yield) || 500;
    const sowingDate = data.date || '2024-06-15';
    const lon = parseFloat(data.lon) || 114.305;
    const lat = parseFloat(data.lat) || 30.592;
    const customSoilData = data.custom_soil_data || {};
    const useCustomSoil = data.use_custom_soil || false;

    const simResult = generateSimulationResponse(cropType, targetYield, sowingDate, lon, lat, customSoilData, useCustomSoil);

    res.json({
      success: true,
      message: '模拟计算成功',
      data: simResult,
      is_simulation: true,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, is_simulation: true });
  }
});

function generateSimulationResponse(cropType, targetYield, sowingDate, lon, lat, customSoilData, useCustomSoil) {
  const simulated = generateSimulatedNutrients(lon, lat);
  const dataSource = { AN: '模拟数据', AP: '模拟数据', AK: '模拟数据' };
  const soilValues = [simulated.AN.value, simulated.AP.value, simulated.AK.value];
  const nutrientLevels = { AN: simulated.AN.nutrient_level, AP: simulated.AP.nutrient_level, AK: simulated.AK.nutrient_level };
  let useCustom = false;

  if (customSoilData && useCustomSoil) {
    if (customSoilData.N != null) { soilValues[0] = customSoilData.N; nutrientLevels.AN = model.getNutrientLevelFromValue(customSoilData.N, 'AN'); dataSource.AN = '手动输入'; useCustom = true; }
    if (customSoilData.P != null) { soilValues[1] = customSoilData.P; nutrientLevels.AP = model.getNutrientLevelFromValue(customSoilData.P, 'AP'); dataSource.AP = '手动输入'; useCustom = true; }
    if (customSoilData.K != null) { soilValues[2] = customSoilData.K; nutrientLevels.AK = model.getNutrientLevelFromValue(customSoilData.K, 'AK'); dataSource.AK = '手动输入'; useCustom = true; }
  }

  let fertilizerUsage, guidance;
  if (cropType === '水稻') {
    fertilizerUsage = {
      '尿素_基肥': Math.round(targetYield * 0.012 * 10) / 10,
      '尿素_分蘖肥': Math.round(targetYield * 0.006 * 10) / 10,
      '尿素_穗肥': Math.round(targetYield * 0.006 * 10) / 10,
      '过磷酸钙_基肥': Math.round(targetYield * 0.002 * 10) / 10,
      '氯化钾_基肥': Math.round(targetYield * 0.004 * 10) / 10
    };
    guidance = ['1. 基肥占总氮肥的50%左右', '2. 分蘖肥移栽后7-10天', '3. 穗肥幼穗分化初期', '4. 注意浅水施肥', '5. （模拟数据）此为示例结果'];
  } else {
    fertilizerUsage = {
      '配方肥_基肥': Math.round(targetYield * 0.1 * 10) / 10,
      '尿素_拔节肥': Math.round(targetYield * 0.03 * 10) / 10,
      '过磷酸钙_基肥': Math.round(targetYield * 0.025 * 10) / 10,
      '氯化钾_基肥': Math.round(targetYield * 0.02 * 10) / 10
    };
    guidance = ['1. 基肥占总氮肥的60%左右', '2. 拔节肥起身拔节期', '3. 孕穗肥孕穗期', '4. 深施覆土', '5. （模拟数据）此为示例结果'];
  }

  return {
    fertilizer_usage: fertilizerUsage,
    stage_advice: { '基肥': '播种前整地时深施', '追肥': cropType === '水稻' ? '分蘖期和穗期追施' : '拔节期和孕穗期追施' },
    guidance,
    calc_params: {
      target_yield: targetYield,
      nutrient_demand: [Math.round(targetYield * 0.022 * 10) / 10, Math.round(targetYield * 0.012 * 10) / 10, Math.round(targetYield * 0.025 * 10) / 10],
      soil_supply: [Math.round(soilValues[0] * 0.15 * 0.3 * 10) / 10, Math.round(soilValues[1] * 0.15 * 0.2 * 10) / 10, Math.round(soilValues[2] * 0.15 * 0.4 * 10) / 10],
      straw_supply: [0, 0, 0],
      soil_nutrients: soilValues,
      nutrient_levels: nutrientLevels,
      data_source: dataSource,
      fertilizer_efficiency: [30, 25, 45],
      recommended_sowing_date: sowingDate,
      recommended_sowing_date_start: sowingDate,
      recommended_sowing_date_end: sowingDate,
      is_default_data: true,
      use_custom_soil: useCustom
    }
  };
}

// 天气API
app.get('/api/weather', async (req, res) => {
  let city = req.query.city || '';
  if (!city) {
    const lon = parseFloat(req.query.lon);
    const lat = parseFloat(req.query.lat);
    if (lon && lat) {
      city = Object.entries(CITY_COORDS).reduce((best, [name, coords]) => {
        const d = (coords.lon - lon) ** 2 + (coords.lat - lat) ** 2;
        return !best || d < best.d ? { name, d } : best;
      }, null)?.name || '武汉';
    } else {
      city = '武汉';
    }
  }
  const result = await getWeatherByCity(city);
  res.json(result);
});

// 施肥时机建议API
app.post('/api/fertilizer_timing', async (req, res) => {
  try {
    const data = req.body || {};
    const cropType = data.crop || '水稻';
    const sowingDate = data.sowing_date;
    let city = data.city;
    const lon = data.lon;
    const lat = data.lat;

    if (!city && lon && lat) {
      city = Object.entries(CITY_COORDS).reduce((best, [name, coords]) => {
        const d = (coords.lon - lon) ** 2 + (coords.lat - lat) ** 2;
        return !best || d < best.d ? { name, d } : best;
      }, null)?.name;
    }

    const weatherResult = await getWeatherByCity(city || '武汉');
    const weatherData = weatherResult.data;
    const growthStage = calculateGrowthStage(cropType, sowingDate);
    const weatherAnalysis = analyzeWeather(weatherData);
    const timingAdvice = generateTimingAdvice(cropType, growthStage, weatherAnalysis);

    res.json({
      success: true,
      city,
      growth_stage: growthStage,
      weather: weatherAnalysis,
      timing_advice: timingAdvice,
      is_simulated: weatherResult.is_simulated || false,
      data_source: weatherResult.data_source || 'Open-Meteo'
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 高德地图API代理
const AMAP_API_KEY = '6ca92cc4bca5ecdd6ad1e15e318863e9';
const AMAP_BASE_URLS = {
  geocode: 'https://restapi.amap.com/v3/geocode/geo',
  regeo: 'https://restapi.amap.com/v3/geocode/regeo',
  weather: 'https://restapi.amap.com/v3/weather/weatherInfo',
  direction: 'https://restapi.amap.com/v3/direction'
};

app.all('/api/amap_proxy', async (req, res) => {
  try {
    const params = req.method === 'GET' ? { ...req.query } : { ...req.body };
    const apiType = params.api_type || 'geocode';
    delete params.api_type;
    params.key = AMAP_API_KEY;
    const baseUrl = AMAP_BASE_URLS[apiType] || AMAP_BASE_URLS.geocode;
    const result = await amapProxyRequest('GET', baseUrl, params);
    res.status(result.status).set('Content-Type', 'application/json').send(result.body);
  } catch (e) {
    res.status(500).json({ error: `代理请求失败: ${e.message}` });
  }
});

// 保存近三年历史产量和施肥数据
app.post('/api/historical_yield', (req, res) => {
  try {
    const body = req.body || {};
    // 计算平均值
    const calcAvg = (...vals) => {
      const nums = vals.filter(v => v != null && !isNaN(Number(v))).map(Number);
      return nums.length ? parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)) : null;
    };
    const data = {
      ...body,
      rice_avg_yield: calcAvg(body.rice_year1_yield, body.rice_year2_yield, body.rice_year3_yield),
      rice_avg_n: calcAvg(body.rice_year1_n, body.rice_year2_n, body.rice_year3_n),
      rice_avg_p: calcAvg(body.rice_year1_p, body.rice_year2_p, body.rice_year3_p),
      rice_avg_k: calcAvg(body.rice_year1_k, body.rice_year2_k, body.rice_year3_k),
      wheat_avg_yield: calcAvg(body.wheat_year1_yield, body.wheat_year2_yield, body.wheat_year3_yield),
      wheat_avg_n: calcAvg(body.wheat_year1_n, body.wheat_year2_n, body.wheat_year3_n),
      wheat_avg_p: calcAvg(body.wheat_year1_p, body.wheat_year2_p, body.wheat_year3_p),
      wheat_avg_k: calcAvg(body.wheat_year1_k, body.wheat_year2_k, body.wheat_year3_k),
      user_ip: req.ip,
      user_session: req.cookies && req.cookies.session_id
    };
    const id = db.saveHistoricalYield(data);
    if (id) {
      res.json({
        success: true,
        message: '历史产量数据已保存',
        id,
        averages: {
          rice: { yield: data.rice_avg_yield, n: data.rice_avg_n, p: data.rice_avg_p, k: data.rice_avg_k },
          wheat: { yield: data.wheat_avg_yield, n: data.wheat_avg_n, p: data.wheat_avg_p, k: data.wheat_avg_k }
        }
      });
    } else {
      res.status(500).json({ success: false, message: '保存失败，请重试' });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: `服务器错误: ${e.message}` });
  }
});

// 获取历史产量记录列表
app.get('/api/historical_yield', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const records = db.getHistoricalYields(limit, offset);
    res.json({ success: true, records, total: records.length });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 地图配置API
app.get('/api/map_config', (req, res) => {
  res.json({
    securityEnabled: true,
    securityCode: '',
    version: '2.0',
    plugins: ['AMap.ToolBar', 'AMap.Scale', 'AMap.Geocoder', 'AMap.Geolocation'],
    defaultCenter: [118.763, 32.057],
    defaultZoom: 12,
    mapStyle: 'normal',
    features: ['bg', 'road', 'building', 'point'],
    validBounds: { minLon: 110, maxLon: 122, minLat: 28, maxLat: 33 }
  });
});

// ==================== 启动服务器 ====================
const PORT = process.env.PORT || 5000;

// 启动服务器并加载GeoTIFF数据
async function startServer() {
  try {
    // 加载GeoTIFF土壤数据
    await loadGeoTIFFs();
    
    // 更新健康检查状态
    const geotiffStatus = geotiffCache.metadata?.loaded ? '可用' : '不可用';
    console.log(`[GeoTIFF] 状态: ${geotiffStatus}`);
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log('='.repeat(50));
      console.log('科学施肥推荐系统 (Node.js/Express)');
      console.log('='.repeat(50));
      console.log(`启动时间: ${new Date().toLocaleString('zh-CN')}`);
      console.log(`访问地址: http://127.0.0.1:${PORT}`);
      console.log(`健康检查: http://127.0.0.1:${PORT}/health`);
      console.log(`GeoTIFF处理器: ${geotiffStatus}`);
      console.log('='.repeat(50));
    });
  } catch (e) {
    console.error('服务器启动失败:', e.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
