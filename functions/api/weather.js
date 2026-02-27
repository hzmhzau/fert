/**
 * Cloudflare Pages Function - 天气 API
 * 路径: /api/weather
 */

// 和风天气 JWT 配置
function getQWeatherConfig(env) {
  return {
    privateKey: env.QWEATHER_PRIVATE_KEY || '',
    keyId: env.QWEATHER_KEY_ID || '',
    projectId: env.QWEATHER_PROJECT_ID || '',
    apiHost: env.QWEATHER_API_HOST || ''
  };
}

// 生成 JWT Token
function generateQWeatherJWT(config) {
  const encoder = new TextEncoder();
  const header = btoa(JSON.stringify({ alg: 'EdDSA', kid: config.keyId }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    sub: config.projectId,
    iat: now - 30,
    exp: now + 900
  }));
  
  // 注意：Cloudflare Workers 不支持 EdDSA 签名
  // 这里返回空 token，使用备选方案
  return null;
}

// 获取天气数据
async function getWeatherData(lat, lon, env) {
  const config = getQWeatherConfig(env);
  
  // 方案1：使用和风天气 API（需要配置）
  if (config.keyId && config.apiHost) {
    try {
      const token = generateQWeatherJWT(config);
      const url = `https://${config.apiHost}/v7/weather/7d?location=${lon},${lat}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept-Encoding': 'gzip'
        }
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      console.error('QWeather API error:', e);
    }
  }
  
  // 方案2：使用 Open-Meteo 免费 API（备选）
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&timezone=Asia/Shanghai&forecast_days=7`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  // 转换为统一格式
  return {
    code: '200',
    daily: data.daily.time.map((time, i) => ({
      fxDate: time,
      weatherCode: data.daily.weathercode[i],
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
      precip: data.daily.precipitation_sum[i],
      windSpeed: data.daily.windspeed_10m_max[i]
    }))
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  
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
    const lat = parseFloat(url.searchParams.get('lat')) || 30.592;
    const lon = parseFloat(url.searchParams.get('lon')) || 114.305;
    
    const weatherData = await getWeatherData(lat, lon, env);
    
    return new Response(JSON.stringify(weatherData), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Failed to fetch weather data',
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