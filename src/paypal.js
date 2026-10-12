class PayPal {
  constructor(config,transport=fetch){this.config=config;this.transport=transport;this.base=config.mode==='sandbox'?'https://api-m.sandbox.paypal.com':'https://api-m.paypal.com';}
  async token(){
    if(this.accessToken&&Date.now()<this.tokenExpiry)return this.accessToken;
    if(!this.config.clientId||!this.config.secret)throw Object.assign(new Error('الدفع غير مفعّل حاليًا. تواصل مع المتجر.'),{status:503});
    const response=await this.transport(this.base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(this.config.clientId+':'+this.config.secret).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Object.assign(new Error('تعذر الاتصال بمزود الدفع. حاول لاحقًا.'),{status:502});
    const data=await response.json();if(!data.access_token)throw new Error('Invalid OAuth response');
    this.accessToken=data.access_token;this.tokenExpiry=Date.now()+Math.max(0,Number(data.expires_in)-60)*1000;return this.accessToken;
  }
  async request(endpoint,body,requestId){
    const token=await this.token();
    const response=await this.transport(this.base+endpoint,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=representation',...(requestId?{'PayPal-Request-Id':requestId}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){const issue=data.details?.[0]?.issue;if(issue==='ORDER_ALREADY_CAPTURED')return {alreadyCaptured:true};const error=Object.assign(new Error(issue==='INSTRUMENT_DECLINED'?'تم رفض وسيلة الدفع. اختر وسيلة أخرى.':'تعذر إكمال العملية لدى PayPal. حاول مجددًا.'),{status:502,issue});throw error;}
    return data;
  }
  create(invoice,origin){return this.request('/v2/checkout/orders',{intent:'CAPTURE',purchase_units:[{reference_id:invoice.id,custom_id:invoice.id,invoice_id:invoice.id,description:invoice.name,amount:{currency_code:invoice.currency,value:(invoice.totalCents/100).toFixed(2)}}],application_context:{brand_name:invoice.brandName,user_action:'PAY_NOW',shipping_preference:'NO_SHIPPING',return_url:origin+'/invoice/'+invoice.token,cancel_url:origin+'/invoice/'+invoice.token+'?cancel=1'}},invoice.createRequestId);}
  get(orderId){return this.request('/v2/checkout/orders/'+encodeURIComponent(orderId));}
  capture(orderId,requestId){return this.request('/v2/checkout/orders/'+encodeURIComponent(orderId)+'/capture',{},requestId);}
  async verify(headers,event){
    if(!this.config.webhookId)return false;
    const fields=['paypal-auth-algo','paypal-cert-url','paypal-transmission-id','paypal-transmission-sig','paypal-transmission-time'];
    if(fields.some(key=>!headers[key]))return false;
    const result=await this.request('/v1/notifications/verify-webhook-signature',{auth_algo:headers[fields[0]],cert_url:headers[fields[1]],transmission_id:headers[fields[2]],transmission_sig:headers[fields[3]],transmission_time:headers[fields[4]],webhook_id:this.config.webhookId,webhook_event:event});
    return result.verification_status==='SUCCESS';
  }
}
module.exports={PayPal};
