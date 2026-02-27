/**
 * Cloudflare Pages Function - 施肥计算 API
 * 路径: /calculate
 */

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
      superphosphate_P_content: 0.46,
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

  calculateFertilizerRecommendation(inputParams, cropType = 'rice') {
    const targetYield = inputParams.target_yield || 500;
    const lon = parseFloat(inputParams.lon) || 114.305;
    const lat = parseFloat(inputParams.lat) || 30.592;
    const customSoilData = inputParams.custom_soil_data;

    // 获取土壤数据
    let soilN, soilP, soilK;
    if (customSoilData && customSoilData.AN && customSoilData.AP && customSoilData.AK) {
      soilN = customSoilData.AN;
      soilP = customSoilData.AP;
      soilK = customSoilData.AK;
    } else {
      const simulatedNutrients = generateSimulatedNutrients(lon, lat);
      soilN = simulatedNutrients.AN.value;
      soilP = simulatedNutrients.AP.value;
      soilK = simulatedNutrients.AK.value;
    }

    // 计算养分需求
    const [reqN, reqP, reqK] = this.calculateNutrientRequirement(targetYield, cropType);
    
    // 计算土壤供应
    const [supplyN, supplyP, supplyK] = this.calculateSoilSupply(soilN, soilP, soilK, cropType);
    
    // 计算肥料需求
    const params = this.defaultParams[cropType];
    const fertN = Math.max(0, (reqN - supplyN) / params.N_fertilizer_efficiency);
    const fertP = Math.max(0, (reqP - supplyP) / params.P_fertilizer_efficiency);
    const fertK = Math.max(0, (reqK - supplyK) / params.K_fertilizer_efficiency);

    // 转换为实物肥料
    const urea = fertN / this.defaultParams.urea_N_content;
    const superphosphate = fertP / this.defaultParams.superphosphate_P_content;
    const potassiumChloride = fertK / this.defaultParams.potassium_chloride_K_content;

    return {
      crop: cropType,
      target_yield: targetYield,
      soil_data: { AN: soilN, AP: soilP, AK: soilK },
      nutrient_requirement: { N: reqN, P: reqP, K: reqK },
      soil_supply: { N: supplyN, P: supplyP, K: supplyK },
      fertilizer_recommendation: {
        urea: Math.round(urea * 10) / 10,
        superphosphate: Math.round(superphosphate * 10) / 10,
        potassium_chloride: Math.round(potassiumChloride * 10) / 10
      },
      application_schedule: {
        base: {
          urea: Math.round(urea * 0.4 * 10) / 10,
          superphosphate: Math.round(superphosphate * 0.7 * 10) / 10,
          potassium_chloride: Math.round(potassiumChloride * 0.5 * 10) / 10
        },
        topdressing: {
          urea: Math.round(urea * 0.6 * 10) / 10,
          potassium_chloride: Math.round(potassiumChloride * 0.5 * 10) / 10
        }
      }
    };
  }
}

const model = new CropRotationFertilizerModel();

export async function onRequest(context) {
  const { request } = context;
  
  // CORS 支持
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  
  try {
    let params = {};
    
    if (request.method === 'POST') {
      const body = await request.json();
      params = body;
    } else {
      const url = new URL(request.url);
      params = {
        target_yield: parseFloat(url.searchParams.get('target_yield')) || 500,
        lat: parseFloat(url.searchParams.get('lat')),
        lon: parseFloat(url.searchParams.get('lon')),
        crop: url.searchParams.get('crop') || 'rice',
        custom_soil_data: url.searchParams.get('soil_n') ? {
          AN: parseFloat(url.searchParams.get('soil_n')),
          AP: parseFloat(url.searchParams.get('soil_p')),
          AK: parseFloat(url.searchParams.get('soil_k'))
        } : null
      };
    }
    
    const cropType = params.crop === 'wheat' ? 'wheat' : 'rice';
    const result = model.calculateFertilizerRecommendation(params, cropType);
    
    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Calculation failed',
      message: error.message
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}