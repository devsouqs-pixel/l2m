const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.ttf':'font/ttf'};
function createCheckoutServer(service,config){
  const limits=new Map(),publicDir=path.join(config.root,'public');
  const send=(response,status,data)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});response.end(JSON.stringify(data));};
  async function body(request){let data='';for await(const part of request){data+=part;if(Buffer.byteLength(data)>131072)throw Object.assign(new Error('Request too large'),{status:413});}try{return JSON.parse(data||'{}');}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}}
  const publicSettings=()=>({brand:{name:config.brand.name,color:config.brand.color,logo:config.checkout.logoPath},storeUrl:config.checkout.storeUrl,paypal:{clientId:config.checkout.paypal.clientId,currency:config.checkout.currency,applePay:config.checkout.paypal.applePay,advancedCards:config.checkout.paypal.advancedCards,configured:Boolean(config.checkout.paypal.clientId&&config.checkout.paypal.secret)},preview:config.checkout.preview});
  return http.createServer(async(request,response)=>{
    response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Frame-Options','DENY');response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' https://*.paypal.com https://*.paypalobjects.com https://applepay.cdn-apple.com; style-src 'self' 'unsafe-inline' https://*.paypal.com; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://*.paypal.com https://*.paypalobjects.com; frame-src https://*.paypal.com https://*.paypalobjects.com; object-src 'none'; base-uri 'self'; form-action 'self' https://*.paypal.com");
    try{
      const url=new URL(request.url,'http://localhost');
      if(url.pathname==='/health'&&request.method==='GET')return send(response,200,{ok:true});
      if(url.pathname==='/api/paypal/webhook'&&request.method==='POST'){const event=await body(request);await service.webhook(request.headers,event);return send(response,200,{received:true});}
      if(url.pathname.startsWith('/api/')){
        const key=request.socket.remoteAddress||'unknown',now=Date.now();let bucket=limits.get(key);
        if(!bucket||now>bucket.reset){bucket={count:0,reset:now+60000};limits.set(key,bucket);}if(++bucket.count>90)return send(response,429,{error:'طلبات كثيرة. انتظر قليلًا.'});
        if(limits.size>10000)for(const [key,value]of limits)if(value.reset<now)limits.delete(key);
        const match=url.pathname.match(/^\/api\/invoices\/([A-Za-z0-9_-]{32})(?:\/(order|capture|refresh|cliq-claim|attempt))?$/);
        if(!match)return send(response,404,{error:'الطلب غير موجود.'});
        const [,token,action]=match;
        if(request.method==='GET'&&!action)return send(response,200,{invoice:service.view(service.find(token)),settings:publicSettings()});
        if(request.method!=='POST'||!action)return send(response,405,{error:'Method not allowed'});
        const expected=config.checkout.publicUrl?new URL(config.checkout.publicUrl).origin:null;
        if(!request.headers.origin||request.headers.origin!==expected)return send(response,403,{error:'مصدر الطلب غير صالح.'});
        const input=await body(request);
        if(action==='order')return send(response,200,await service.order(token,input.method));
        if(action==='capture')return send(response,200,await service.capture(token,input.orderId));
        if(action==='refresh')return send(response,200,{invoice:await service.refresh(token)});
        if(action==='cliq-claim')return send(response,200,await service.claimCliq(token));
        if(action==='attempt')return send(response,200,await service.recordAttempt(token,input));
      }
      if(request.method!=='GET'&&request.method!=='HEAD')return send(response,405,{error:'Method not allowed'});
      let file;
      if(url.pathname==='/'||/^\/invoice\/[A-Za-z0-9_-]{32}$/.test(url.pathname))file='index.html';
      else if(url.pathname==='/preview'&&config.checkout.preview)file='index.html';
      else if(/^\/((?:checkout|terminal-3d|receipt)\.(?:css|js)|assets\/(?:logo\.png|paypal\.png|cliq\.png|Manrope\.ttf|NotoSansArabic\.ttf)|vendor\/three\.(?:module|core)\.min\.js)$/.test(url.pathname))file=url.pathname.slice(1);
      else if(url.pathname==='/.well-known/apple-developer-merchantid-domain-association')file='.well-known/apple-developer-merchantid-domain-association';
      if(!file)return send(response,404,{error:'الصفحة غير موجودة.'});
      const absolute=path.join(publicDir,file);if(!fs.existsSync(absolute))return send(response,404,{error:'الملف غير موجود.'});
      let data=fs.readFileSync(absolute);
      if(url.pathname==='/preview'&&config.checkout.preview){const settings=publicSettings();settings.paypal={configured:false};const preview={settings,invoice:{id:'L2M-261012-A7C920',name:'حزمة إدارة السيرفر',currency:'USD',baseCents:1000,feeCents:77,totalCents:1077,feeLabel:config.checkout.fee.label,status:'UNPAID',cliq:{amountFils:7090,rate:0.709,phone:config.checkout.cliq?.phone||'',bank:config.checkout.cliq?.bank||'',beneficiaryName:config.checkout.cliq?.beneficiaryName||''},createdAt:Date.now(),expiresAt:Date.now()+86400000}};data=Buffer.from(data.toString().replace('</head>','<script>window.L2M_PREVIEW='+JSON.stringify(preview).replace(/</g,'\\u003c')+'</script></head>'));}
      response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':file.startsWith('assets/')?'public, max-age=86400':'no-store'});response.end(request.method==='HEAD'?undefined:data);
    }catch(error){const safe=error.status&&/[\u0600-\u06ff]/.test(error.message)?error.message:'تعذر إكمال العملية. حاول مجددًا أو تواصل مع المتجر.';send(response,error.status||500,{error:safe});}
  });
}
module.exports={createCheckoutServer};
