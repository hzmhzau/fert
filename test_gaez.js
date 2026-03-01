const GeoTIFF = require('geotiff');

(async () => {
  try {
    console.log('开始加载GAEZ-V5水稻潜在产量数据...');
    const tiff = await GeoTIFF.fromFile('cropped_GAEZ-V5.RES05-YCX30AS.HP0120.AGERA5.HIST.RCW.HILM_41d6e80a.tif');
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const data = rasters[0];
    
    console.log('图像尺寸:', image.getWidth(), 'x', image.getHeight());
    
    // 使用 reduce 方法避免栈溢出
    let minVal = Infinity, maxVal = -Infinity;
    let sumVal = 0, countVal = 0;
    for (const val of data) {
      if (val > 0 && val < 10000) {
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;
        sumVal += val;
        countVal++;
      }
    }
    
    console.log('数据范围:', minVal, '-', maxVal);
    
    // 统计数据分布
    const stats = {};
    for (const val of data) {
      if (val > 0 && val < 10000) {
        const range = Math.floor(val / 100) * 100;
        stats[range] = (stats[range] || 0) + 1;
      }
    }
    
    console.log('\n数据分布 (每100kg/ha为一个区间):');
    const sorted = Object.entries(stats).sort((a, b) => a[0] - b[0]);
    for (const [range, count] of sorted.slice(0, 20)) {
      console.log(`  ${range}-${range + 99}: ${count} 像素`);
    }
    
    console.log('\n有效值统计:');
    console.log('  最小值:', minVal);
    console.log('  最大值:', maxVal);
    console.log('  平均值:', Math.round(sumVal / countVal));
    
    // 找到NoData值
    const noDataCount = data.filter(v => v === 0).length;
    console.log('\nNoData值 (0):', noDataCount, '像素');
    console.log('有效值数量:', countVal, '像素');
    
    // 获取边界信息
    const bbox = image.getBoundingBox();
    console.log('\n边界范围:');
    console.log('  minX:', bbox[0]);
    console.log('  maxX:', bbox[2]);
    console.log('  minY:', bbox[1]);
    console.log('  maxY:', bbox[3]);
    
    // 测试几个坐标点
    console.log('\n测试坐标点:');
    const testCoords = [
      { lon: 114.305, lat: 30.592 }, // 武汉
      { lon: 118.763, lat: 32.057 }, // 南京
      { lon: 121.473, lat: 31.230 }, // 上海
      { lon: 115.858, lat: 28.676 }, // 南昌
      { lon: 112.938, lat: 28.228 }, // 长沙
    ];
    
    const cellWidth = (bbox[2] - bbox[0]) / image.getWidth();
    const cellHeight = (bbox[3] - bbox[1]) / image.getHeight();
    
    for (const coord of testCoords) {
      const col = Math.floor((coord.lon - bbox[0]) / cellWidth);
      const row = Math.floor((bbox[3] - coord.lat) / cellHeight);
      
      if (col >= 0 && col < image.getWidth() && row >= 0 && row < image.getHeight()) {
        const idx = row * image.getWidth() + col;
        const value = data[idx];
        const yieldPerMu = Math.round(value / 666.67 * 10) / 10;
        
        console.log(`  ${coord.lon}, ${coord.lat} -> 像素[${col}, ${row}] = ${value} kg/ha = ${yieldPerMu} kg/亩`);
      } else {
        console.log(`  ${coord.lon}, ${coord.lat} -> 坐标超出范围`);
      }
    }
    
  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
  }
})();
