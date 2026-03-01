const { generateKeyPairSync } = require('crypto');
const fs = require('fs');

const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding:  { type: 'spki',  format: 'pem' }
});

fs.writeFileSync('ed25519-private.pem', privateKey);
fs.writeFileSync('ed25519-public.pem',  publicKey);

console.log('✅ 密钥对生成成功！');
console.log('\n=== 私钥（填入 server.js）===');
console.log(privateKey);
console.log('=== 公钥（上传到和风天气控制台）===');
console.log(publicKey);