/**
 * Cloudflare Pages Function - 土壤数据测试 API
 * 路径: /test_geotiff
 * 
 * 注意：Cloudflare Workers 不支持读取 GeoTIFF 文件
 * 这里提供基于经纬度的模拟数据
 */

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
  // 基于长江中下游地区的典型土壤养分分布模拟
  const baseAN = 89.2 + (lon - 114) * 2 + (lat - 30) * 3;
  const baseAP = 23.8 + (lon - 114) * 0.5 + (lat - 30) * 0.8;
  const baseAK = 105.0 + (lon - 114) * 1.5 + (lat - 30) * 2;
  
  const rand = (min, max) => Math.random() * (max - min) + min;
  
  const AN = Math.max(50, Math.min(150, baseAN + rand(-10, 10)));
  const AP = Math.max(5, Math.min(40, baseAP + rand(-5, 5)));
  const AK = Math.max(60, Math.min(200, baseAK + rand(-20, 20)));

  const makeEntry = (val, layer, desc) => ({
    value: Math.round(val * 10) / 10,
    layer,
    description: desc,
    coordinate: { lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000 },
    pixel_location: { row: -1, col: -1 },
    nutrient_level: getNutrientLevel(val, layer),
    data_source: '模拟数据（Cloudflare Workers 不支持 GeoTIFF）',
    is_default: true
  });

  return {
    AN: makeEntry(AN, 'AN', '土壤碱解氮含量 (mg/kg)'),
    AP: makeEntry(AP, 'AP', '土壤有效磷含量 (mg/kg)'),
    AK: makeEntry(AK, 'AK', '土壤有效钾含量 (mg/kg)')
  };
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // CORS 支持
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
  
  try {
    const lat = parseFloat(url.searchParams.get('lat')) || 30.592;
    const lon = parseFloat(url.searchParams.get('lon')) || 114.305;
    
    const result = generateSimulatedNutrients(lon, lat);
    
    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to generate soil data',
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