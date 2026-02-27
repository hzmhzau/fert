/**
 * Cloudflare Pages Function - 施肥时机建议 API
 * 路径: /api/fertilizer_timing
 */

// 农时配置
const FARMING_CONFIG = {
  rice: {
    name: '水稻',
    stages: [
      { name: '基肥', period: '移栽前7-10天', method: '撒施翻耕', ratio: 0.4 },
      { name: '分蘖肥', period: '移栽后7-10天', method: '撒施', ratio: 0.3 },
      { name: '穗肥', period: '幼穗分化期', method: '撒施', ratio: 0.2 },
      { name: '粒肥', period: '抽穗后', method: '叶面喷施', ratio: 0.1 }
    ]
  },
  wheat: {
    name: '小麦',
    stages: [
      { name: '基肥', period: '播种前', method: '撒施翻耕', ratio: 0.5 },
      { name: '越冬肥', period: '12月中下旬', method: '撒施', ratio: 0.2 },
      { name: '返青肥', period: '2月下旬-3月初', method: '撒施', ratio: 0.2 },
      { name: '拔节肥', period: '3月中下旬', method: '撒施', ratio: 0.1 }
    ]
  }
};

// 根据天气获取施肥建议
function getFertilizerTimingAdvice(crop, weatherData) {
  const config = FARMING_CONFIG[crop] || FARMING_CONFIG.rice;
  const advice = [];
  
  // 分析未来7天天气
  const rainyDays = weatherData?.daily?.filter(d => d.precip > 5).length || 0;
  const avgTemp = weatherData?.daily?.reduce((sum, d) => sum + (d.tempMax + d.tempMin) / 2, 0) / 7 || 20;
  
  for (const stage of config.stages) {
    const stageAdvice = {
      stage: stage.name,
      period: stage.period,
      method: stage.method,
      ratio: stage.ratio,
      weather_warning: null,
      best_timing: null
    };
    
    // 天气预警
    if (rainyDays >= 3) {
      stageAdvice.weather_warning = '未来有较多降雨，建议避免雨前施肥，防止养分流失';
    }
    
    if (avgTemp < 10) {
      stageAdvice.weather_warning = '气温较低，肥料分解较慢，建议适当增加用量';
    }
    
    // 最佳时机建议
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    
    if (crop === 'rice') {
      if (stage.name === '基肥' && currentMonth >= 5 && currentMonth <= 6) {
        stageAdvice.best_timing = '当前正是水稻基肥施用的好时机';
      } else if (stage.name === '分蘖肥' && currentMonth >= 6 && currentMonth <= 7) {
        stageAdvice.best_timing = '当前适合施用分蘖肥';
      }
    } else if (crop === 'wheat') {
      if (stage.name === '基肥' && currentMonth >= 10 && currentMonth <= 11) {
        stageAdvice.best_timing = '当前正是小麦播种和基肥施用的好时机';
      } else if (stage.name === '返青肥' && currentMonth >= 2 && currentMonth <= 3) {
        stageAdvice.best_timing = '当前适合施用返青肥';
      }
    }
    
    advice.push(stageAdvice);
  }
  
  return {
    crop: config.name,
    current_date: new Date().toISOString().split('T')[0],
    weather_summary: {
      rainy_days_next_week: rainyDays,
      avg_temperature: Math.round(avgTemp * 10) / 10
    },
    fertilization_schedule: advice
  };
}

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
      params = await request.json();
    } else {
      const url = new URL(request.url);
      params = {
        crop: url.searchParams.get('crop') || 'rice',
        weather: url.searchParams.get('weather') ? JSON.parse(url.searchParams.get('weather')) : null
      };
    }
    
    const cropType = params.crop === 'wheat' ? 'wheat' : 'rice';
    const result = getFertilizerTimingAdvice(cropType, params.weather);
    
    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to get fertilizer timing advice',
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