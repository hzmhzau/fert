/**
 * Cloudflare Workers 版本 - 科学施肥推荐系统 API
 * 使用 Hono 框架（轻量级、兼容 Workers）
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';

const app = new Hono();

// ==================== 中间件 ====================
app.use('/*', cors());

// ==================== 静态文件服务 ====================
app.get('/', serveStatic({ path: './index.html' }));
app.get('/static/*', serveStatic({ root: './' }));

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
  return {
    AN: { value: Math.round(AN * 10) / 10, nutrient_level: getNutrientLevel(AN, 'AN'), data_source: '模拟数据' },
    AP: { value: Math.round(AP * 10) / 10, nutrient_level: getNutrientLevel(AP, 'AP'), data_source: '模拟数据' },
    AK: { value: Math.round(AK * 10) / 10, nutrient_level: getNutrientLevel(AK, 'AK'), data_source: '模拟数据' }
  };
}

// ==================== 施肥模型 ====================
class CropRotationFertilizerModel {
  constructor() {
    this.defaultParams = {
      urea_N_content: 0.46,
      superphosphate_P_content: 0.12,
      potassium_chloride_K_content: 0.60,
      rice: {
        N_per_100kg: 2.2, P_per_100kg: 1.2, K_per_100kg: 2.5,
        N_fertilizer_efficiency: 0.30, P_fertilizer_efficiency: 0.25, K_fertilizer_efficiency: 0.45,
      },
      wheat: {
        N_per_100kg: 3.0, P_per_100kg: 1.5, K_per_100kg: 2.8,
        N_fertilizer_efficiency: 0.40, P_fertilizer_efficiency: 0.18, K_fertilizer_efficiency: 0.50,
      }
    };
  }

  calculateNutrientRequirement(targetYield, cropType) {
    const p = this.defaultParams[cropType];
    return [
      (targetYield / 100) * p.N_per_100kg,
      (targetYield / 100) * p.P_per_100kg,
      (targetYield / 100) * p.K_per_100kg
    ];
  }

  calculateSoilSupply(soilN, soilP, soilK, cropType) {
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
    return [
      soilN * convFactor * nCorr,
      soilP * convFactor * pCorr,
      soilK * convFactor * kCorr
    ];
  }

  calculateFertilizerRecommendation(inputParams, cropType) {
    const targetYield = inputParams.target_yield || 500;
    const lon = parseFloat(inputParams.lon) || 114.305;
    const lat = parseFloat(inputParams.lat) || 30.592;
    const customSoilData = inputParams.custom_soil_data;

    // 获取土壤数据
    let soilN = customSoilData?.N ?? 89.2;
    let soilP = customSoilData?.P ?? 23.8;
    let soilK = customSoilData?.K ?? 105.0;

    // 计算需肥量
    const [nReq, pReq, kReq] = this.calculateNutrientRequirement(targetYield, cropType);
    
    // 计算土壤供肥量
    const [nSoil, pSoil, kSoil] = this.calculateSoilSupply(soilN, soilP, soilK, cropType);

    // 肥料利用率
    const cropP = this.defaultParams[cropType];
    const nEff = cropP.N_fertilizer_efficiency;
    const pEff = cropP.P_fertilizer_efficiency;
    const kEff = cropP.K_fertilizer_efficiency;

    // 计算施肥量
    const nFertilizer = Math.max(0, (nReq - nSoil) / nEff);
    const pFertilizer = Math.max(0, (pReq - pSoil) / pEff);
    const kFertilizer = Math.max(0, (kReq - kSoil) / kEff);

    const dp = this.defaultParams;
    let recommendation;

    if (cropType === 'rice') {
      recommendation = {
        '肥料用量_公斤每亩': {
          '尿素_基肥': Math.round(nFertilizer * 0.50 / dp.urea_N_content * 10) / 10,
          '尿素_分蘖肥': Math.round(nFertilizer * 0.25 / dp.urea_N_content * 10) / 10,
          '尿素_穗肥': Math.round(nFertilizer * 0.25 / dp.urea_N_content * 10) / 10,
          '重过磷酸钙_基肥': Math.round(pFertilizer / dp.superphosphate_P_content * 10) / 10,
          '氯化钾_基肥': Math.round(kFertilizer * 0.6 / dp.potassium_chloride_K_content * 10) / 10,
          '氯化钾_穗肥': Math.round(kFertilizer * 0.4 / dp.potassium_chloride_K_content * 10) / 10,
        },
        '施肥时期建议': { '基肥': '整地时深施', '分蘖肥': '移栽后7-10天', '穗肥': '幼穗分化初期' }
      };
    } else {
      recommendation = {
        '肥料用量_公斤每亩': {
          '配方肥_基肥': Math.round(targetYield * 0.1 * 10) / 10,
          '尿素_拔节肥': Math.round(targetYield * 0.03 * 10) / 10,
          '重过磷酸钙_基肥': Math.round(pFertilizer / dp.superphosphate_P_content * 10) / 10,
          '氯化钾_基肥': Math.round(kFertilizer / dp.potassium_chloride_K_content * 10) / 10,
        },
        '施肥时期建议': { '基肥': '播种前整地时深施', '拔节肥': '起身拔节期结合灌水追施' }
      };
    }

    return recommendation;
  }
}

const model = new CropRotationFertilizerModel();

// ==================== API 路由 ====================

// 健康检查
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'fertilizer-recommendation',
    version: '2.0.0-workers',
    timestamp: new Date().toISOString(),
    platform: 'Cloudflare Workers'
  });
});

// API 测试
app.all('/api/test', (c) => {
  return c.json({
    success: true,
    message: `API测试成功 (${c.req.method})`,
    timestamp: new Date().toISOString()
  });
});

// 测试土壤数据
app.get('/test_geotiff', (c) => {
  const lon = parseFloat(c.req.query('lon')) || 114.305;
  const lat = parseFloat(c.req.query('lat')) || 30.592;
  
  const nutrients = generateSimulatedNutrients(lon, lat);
  
  return c.json({
    success: true,
    coordinate: { lon, lat },
    nutrients,
    is_default_data: true,
    message: '使用模拟数据（Workers 版本）'
  });
});

// 计算施肥方案
app.post('/calculate', async (c) => {
  try {
    const data = await c.req.json();
    
    const cropType = data.crop;
    const targetYield = parseFloat(data.yield);
    const lon = parseFloat(data.lon) || 114.305;
    const lat = parseFloat(data.lat) || 30.592;
    const customSoilData = data.custom_soil_data || {};
    const useCustomSoil = data.use_custom_soil || false;

    if (!cropType || !['水稻', '小麦'].includes(cropType)) {
      return c.json({ error: '作物类型必须是"水稻"或"小麦"' }, 400);
    }
    if (!targetYield || targetYield <= 0 || targetYield > 1000) {
      return c.json({ error: '产量必须在1-1000之间' }, 400);
    }

    const params = {
      target_yield: targetYield,
      lon, lat,
      custom_soil_data: useCustomSoil ? customSoilData : null
    };

    const internalCrop = cropType === '水稻' ? 'rice' : 'wheat';
    const recommendation = model.calculateFertilizerRecommendation(params, internalCrop);

    // 生成指导建议
    const guidance = [];
    if (cropType === '水稻') {
      guidance.push('1. 基肥占总氮肥的50%左右，磷钾肥全部作基肥');
      guidance.push('2. 分蘖肥在移栽后7-10天施用，促进分蘖');
      guidance.push('3. 穗肥在幼穗分化初期施用，促进大穗形成');
      guidance.push('4. 注意浅水施肥，提高肥料利用率');
    } else {
      guidance.push('1. 基肥占总氮肥的60%左右，磷钾肥全部作基肥');
      guidance.push('2. 拔节肥在起身拔节期施用，促进茎秆健壮');
      guidance.push('3. 注意深施覆土，减少肥料损失');
    }

    return c.json({
      fertilizer_usage: recommendation['肥料用量_公斤每亩'],
      stage_advice: recommendation['施肥时期建议'],
      guidance,
      is_workers_version: true
    });
  } catch (e) {
    return c.json({ error: `计算失败: ${e.message}` }, 500);
  }
});

// 天气 API
app.get('/api/weather', async (c) => {
  const city = c.req.query('city') || '武汉';
  
  // 模拟天气数据
  const conditions = ['晴', '多云', '阴', '小雨'];
  const weather = conditions[Math.floor(Math.random() * conditions.length)];
  const temp = 15 + Math.floor(Math.random() * 20);
  
  return c.json({
    success: true,
    data: {
      status: '1',
      lives: [{
        city,
        weather,
        temperature: String(temp),
        humidity: String(40 + Math.floor(Math.random() * 50)),
        winddirection: '北',
        windpower: String(Math.floor(Math.random() * 4))
      }]
    },
    is_simulated: true,
    data_source: '模拟数据（Workers 版本）'
  });
});

// 地图配置
app.get('/api/map_config', (c) => {
  return c.json({
    securityEnabled: true,
    version: '2.0',
    plugins: ['AMap.ToolBar', 'AMap.Scale', 'AMap.Geocoder', 'AMap.Geolocation'],
    defaultCenter: [118.763, 32.057],
    defaultZoom: 12
  });
});

// 404 处理
app.notFound((c) => {
  return c.json({ error: '未找到资源' }, 404);
});

// 错误处理
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: err.message }, 500);
});

export default app;
