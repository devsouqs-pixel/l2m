const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
function logoPath(config){
  const value=config.checkout.logoPath||'/assets/logo.png';
  if(!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(value))throw new Error('Invalid checkout.logoPath');
  return value;
}
function logoVersion(config){
  const value=logoPath(config),file=path.join(config.root||path.resolve(__dirname,'..'),'public',value.slice(1));
  const revision=fs.existsSync(file)?createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12):'missing';
  return value+'?v='+revision;
}
function logoUrl(config){
  if(/^https:\/\//.test(config.brand.logoUrl||''))return config.brand.logoUrl;
  if(/^https:\/\//.test(config.checkout.publicUrl||''))return new URL(logoVersion(config),config.checkout.publicUrl).href;
}
module.exports={logoPath,logoVersion,logoUrl};
