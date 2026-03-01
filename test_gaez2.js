const GeoTIFF = require('geotiff');

(async () => {
  try {
    console.log('开始加载GAEZ-V5水稻潜在产量数据...');
    const tiff = await GeoTIFF.fromFile('cropped_GAEZ-V5.RES05-YCX30AS.HP0120.AGERA5.HIST.RCW.HILM_41d6e80a.tif');
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const data = rasters[0];
    
    const bbox = image.getBoundingBox();
    const cellWidth = (bbox[2] - bbox[0]) / image.getWidth();
    const cellHeight = (bbox[3] - bbox[1]) / image.getHeight();
    
    console.log('边界范围:');
    console.log('  minX:', bbox[0]);
    console.log('  maxX:', bbox[2]);
    console.log('  minY:', bbox[1]);
    console.log('  maxY:', bbox[3]);
    console.log('  cellWidth:', cellWidth);
    console.log('  cellHeight:', cellHeight);
    
    // 找到有数据的坐标点
    console.log('\n查找有数据的坐标点:');
    const validCoords = [];
    for (let row = 0; row < image.getHeight(); row++) {
      for (let col = 0; col < image.getWidth(); col++) {
        const idx = row * image.getWidth() + col;
        const value = data[idx];
        if (value > 0 && value < 10000) {
          const lon = bbox[0] + col * cellWidth;
          const lat = bbox[3] - row * cellHeight;
          validCoords.push({ lon, lat, value });
          if (validCoords.length >= 5) break;
        }
      }
      if (validCoords.length >= 5) break;
    }
    
    for (const coord of validCoords) {
      const yieldPerMu = Math.round(coord.value / 666.67 * 10) / 10;
      console.log(`  ${coord.lon.toFixed(4)}, ${coord.lat.toFixed(4)} -> ${coord.value} kg/ha = ${yieldPerMu} kg/亩`);
    }
    
    // 测试几个坐标点
    console.log('\n测试坐标点:');
    const testCoords = [
      { lon: 114.305, lat: 30.592 }, // 武汉
      { lon: 118.763, lat: 32.057 }, // 南京
      { lon: 121.473, lat: 31.230 }, // 上海
    ];
    
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
