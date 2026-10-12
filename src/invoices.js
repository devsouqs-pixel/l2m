const {randomBytes,randomUUID}=require('node:crypto');
const {Locks}=require('./store');
const {PayPal}=require('./paypal');
function price(amount,fee,maximum=10000){
  const text=String(amount);
  if(!/^\d+(?:\.\d{1,2})?$/.test(text))throw new Error('اكتب مبلغًا موجبًا بمنزلتين عشريتين كحد أقصى.');
  const [whole,fraction='']=text.split('.');const baseCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(baseCents)||baseCents<100||baseCents>maximum*100)throw new Error(`المبلغ المسموح من 1 إلى ${maximum}.`);
  const basisPoints=Math.round(Number(fee.percentage)*100),fixedCents=Math.round(Number(fee.fixed)*100);
  if(!Number.isInteger(basisPoints)||basisPoints<0||basisPoints>=10000||!Number.isSafeInteger(fixedCents)||fixedCents<0)throw new Error('إعدادات رسوم الخدمة غير صحيحة.');
  const totalCents=!fee.enabled?baseCents:fee.calculation==='gross-up'?Math.round((baseCents+fixedCents)*10000/(10000-basisPoints)):baseCents+Math.round(baseCents*basisPoints/10000)+fixedCents;
  return {baseCents,feeCents:totalCents-baseCents,totalCents};
}
class Invoices {
  constructor(store,config,paypal){
    this.store=store;this.config=config;this.settings=config.checkout;this.paypal=paypal||new PayPal(this.settings.paypal);this.locks=new Locks();
    store.data.invoices||={};store.data.paymentEvents||={};store.data.paymentOutbox||={};
    for(const job of Object.values(store.data.paymentOutbox))if(!job.dmStatus){job.dmStatus=job.status==='QUEUED'&&store.data.invoices[job.invoiceToken]?.customerId?'QUEUED':'SKIPPED';job.dmAttempts=0;job.dmNextAt=Date.now();}
    store.save();
  }
  create({amount,name,customerId,createdBy,guildId,channelId}){
    const origin=this.settings.publicUrl;
    if(!/^https:\/\/[^\s]+$/.test(origin))throw new Error('حدد PUBLIC_URL برابط HTTPS الخاص بخدمة Railway أولًا.');
    if(this.settings.currency!=='USD')throw new Error('هذه النسخة تستعمل USD.');
    const token=randomBytes(24).toString('base64url');
    const invoice={id:'L2M-'+new Date().toISOString().slice(2,10).replaceAll('-','')+'-'+randomBytes(3).toString('hex').toUpperCase(),token,name:String(name||'طلب من '+this.config.brand.name).trim().slice(0,120),customerId:customerId||null,createdBy,guildId,channelId,currency:this.settings.currency,...price(amount,this.settings.fee,this.settings.maximumAmount),brandName:this.config.brand.name,status:'UNPAID',createdAt:Date.now(),expiresAt:Date.now()+this.settings.invoiceLifetimeHours*3600000,createRequestId:randomUUID(),captureRequestId:randomUUID(),attempts:[],orders:[]};
    if(this.settings.cliq?.enabled){const rate=Number(this.settings.cliq.usdToJod);if(!Number.isFinite(rate)||rate<=0||rate>10)throw new Error('سعر تحويل CliQ غير صحيح.');invoice.cliq={amountFils:Math.round(invoice.baseCents*10*rate),rate,phone:this.settings.cliq.phone,bank:this.settings.cliq.bank,beneficiaryName:this.settings.cliq.beneficiaryName||''};}
    this.store.data.invoices[token]=invoice;if(invoice.customerId)this.queue(invoice,'created:'+invoice.id,'UNPAID');this.store.audit(guildId,createdBy,'invoice.create',invoice.id);return invoice;
  }
  find(token){const invoice=this.store.data.invoices[token];if(!invoice)throw Object.assign(new Error('رابط الفاتورة غير موجود.'),{status:404});return invoice;}
  view(invoice){return {id:invoice.id,name:invoice.name,currency:invoice.currency,baseCents:invoice.baseCents,feeCents:invoice.feeCents,totalCents:invoice.totalCents,feeLabel:this.settings.fee.label,status:invoice.status,expired:invoice.status==='UNPAID'&&Date.now()>invoice.expiresAt,createdAt:invoice.createdAt,expiresAt:invoice.expiresAt,paidAt:invoice.paidAt||null,captureId:invoice.captureId||null,paymentMethod:invoice.paymentMethod||null,paymentReference:invoice.paymentReference||invoice.captureId||null,cliq:invoice.cliq?{...invoice.cliq,beneficiaryLastName:this.settings.cliq?.beneficiaryLastName||'FOUDEH'}:null};}
  payable(invoice){if(invoice.status==='CANCELLED')throw Object.assign(new Error('تم إلغاء هذه الفاتورة. تواصل مع المتجر.'),{status:409});if(['PAID','REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(invoice.status))throw Object.assign(new Error('هذه الفاتورة مدفوعة مسبقًا.'),{status:409});if(['PENDING','CLIQ_REVIEW'].includes(invoice.status))throw Object.assign(new Error('الدفع قيد المراجعة. انتظر تحديث الحالة.'),{status:409});if(Date.now()>invoice.expiresAt)throw Object.assign(new Error('انتهت صلاحية الفاتورة. اطلب رابطًا جديدًا من المتجر.'),{status:410});}
  async checkExistingPayments(invoice){for(const orderId of invoice.orders?.length?invoice.orders:invoice.orderId?[invoice.orderId]:[]){const order=await this.paypal.get(orderId);if(order.status==='COMPLETED'||order.purchase_units?.[0]?.payments?.captures?.length)this.reconcile(invoice,order);if(['PAID','PENDING'].includes(invoice.status))return;}}
  async claimCliq(token){return this.locks.run(token,async()=>{
    const invoice=this.find(token);if(!this.settings.cliq?.enabled||!invoice.cliq)throw Object.assign(new Error('الدفع عبر CliQ غير متاح لهذه الفاتورة.'),{status:409});
    if(invoice.status==='CLIQ_REVIEW')return {invoice:this.view(invoice)};this.payable(invoice);
    await this.checkExistingPayments(invoice);if(invoice.status==='PAID')return {invoice:this.view(invoice)};this.payable(invoice);
    invoice.status='CLIQ_REVIEW';invoice.cliqClaim={id:randomUUID(),claimedAt:Date.now()};this.queue(invoice,'cliq-review:'+invoice.id,'CLIQ_REVIEW');this.store.audit(invoice.guildId,invoice.customerId||'checkout','invoice.cliq-claim',invoice.id);return {invoice:this.view(invoice)};
  });}
  async confirmCliq({id,guildId,staffId,action}){
    if(!['confirm','cancel'].includes(action))throw new Error('اختر تأكيد الحوالة أو إلغاء الفاتورة.');
    const target=Object.values(this.store.data.invoices).find(value=>value.id===id&&value.guildId===guildId);if(!target)throw new Error('الفاتورة غير موجودة في هذا السيرفر.');
    return this.locks.run(target.token,async()=>{
      const invoice=this.find(target.token);if(invoice.status!=='CLIQ_REVIEW'||!invoice.cliq)throw new Error('الفاتورة ليست بانتظار مراجعة حوالة CliQ.');
      await this.checkExistingPayments(invoice);if(invoice.status!=='CLIQ_REVIEW')throw new Error('يوجد دفع إلكتروني مكتمل أو قيد التأكيد. راجع الدفعات قبل اعتماد الحوالة.');
      if(action==='cancel'){invoice.status='CANCELLED';invoice.cancelledAt=Date.now();invoice.cancelledBy=staffId;this.queue(invoice,'cliq-cancel:'+invoice.id,'CANCELLED');this.store.audit(guildId,staffId,'invoice.cliq-cancel',invoice.id);return invoice;}
      invoice.status='PAID';invoice.paymentMethod='CLIQ';invoice.paymentReference=invoice.id;invoice.paidAt=Date.now();invoice.confirmedBy=staffId;
      this.queue(invoice,'cliq-paid:'+invoice.id,'PAID',invoice.id);this.store.audit(guildId,staffId,'invoice.cliq-confirm',invoice.id);return invoice;
    });
  }
  method(value){const method=String(value||'PAYPAL').toUpperCase();if(!['PAYPAL','CARD','APPLE_PAY','CLIQ'].includes(method))throw Object.assign(new Error('وسيلة الدفع غير صحيحة.'),{status:400});return method;}
  async recordAttempt(token,{kind,method,attemptId}={}){return this.locks.run(token,async()=>{
    if(!['cancel','failure'].includes(kind)||!/^[A-Za-z0-9_-]{16,80}$/.test(String(attemptId||'')))throw Object.assign(new Error('تفاصيل محاولة الدفع غير صحيحة.'),{status:400});
    const invoice=this.find(token),paymentMethod=this.method(method);
    if(invoice.status!=='UNPAID')return {invoice:this.view(invoice)};
    await this.checkExistingPayments(invoice);if(invoice.status!=='UNPAID')return {invoice:this.view(invoice)};
    const type=kind==='cancel'?'PAYMENT_CANCELLED':'PAYMENT_FAILED',key='attempt:'+invoice.id+':'+attemptId+':'+type;
    if(this.store.data.paymentOutbox[key])return {invoice:this.view(invoice)};
    const recent=(invoice.attempts||[]).filter(attempt=>attempt.at>Date.now()-600000);
    if(recent.length>=12)throw Object.assign(new Error('انتظر قليلًا قبل بدء محاولة دفع أخرى.'),{status:429});
    invoice.attempts=[...recent,{at:Date.now(),kind,method:paymentMethod,attemptId}];this.queue(invoice,key,type,null,paymentMethod);this.store.save();return {invoice:this.view(invoice)};
  });}
  async order(token,method){return this.locks.run(token,async()=>{
    const invoice=this.find(token);this.payable(invoice);invoice.checkoutMethod=this.method(method);if(invoice.checkoutMethod==='CLIQ')throw Object.assign(new Error('استعمل خيار التحويل عبر CliQ.'),{status:400});
    if(invoice.orderId&&Date.now()-(invoice.orderCreatedAt||0)<25*60000){const existing=await this.paypal.get(invoice.orderId);if(['CREATED','APPROVED','PAYER_ACTION_REQUIRED'].includes(existing.status))return {id:existing.id};if(existing.status==='COMPLETED'){this.reconcile(invoice,existing);return {paid:true,invoice:this.view(invoice)};}}
    if(invoice.orderId){invoice.createRequestId=randomUUID();invoice.captureRequestId=randomUUID();}
    this.store.save();
    const order=await this.paypal.create(invoice,this.settings.publicUrl);
    if(!order.id)throw new Error('تعذر إنشاء رابط الدفع.');
    invoice.orderId=order.id;invoice.orderCreatedAt=Date.now();invoice.orders||=[];if(!invoice.orders.includes(order.id))invoice.orders.push(order.id);invoice.expectedMerchantId=this.settings.paypal.merchantId||order.purchase_units?.[0]?.payee?.merchant_id||null;this.queue(invoice,'started:'+order.id,'PAYMENT_STARTED');this.store.save();return {id:order.id};
  });}
  reconcile(invoice,order){
    if(!(invoice.orders||[invoice.orderId]).includes(order.id))throw new Error('Payment order mismatch');
    const units=order.purchase_units||[];if(units.length!==1)throw new Error('Payment units mismatch');const unit=units[0];
    if(unit.custom_id!==invoice.id||unit.invoice_id!==invoice.id||unit.amount?.currency_code!==invoice.currency||unit.amount?.value!==(invoice.totalCents/100).toFixed(2))throw new Error('Payment amount or invoice mismatch');
    const merchant=this.settings.paypal.merchantId||invoice.expectedMerchantId;if(merchant&&unit.payee?.merchant_id!==merchant)throw new Error('Payment merchant mismatch');
    const captures=unit.payments?.captures||[],capture=captures.find(value=>value.status==='COMPLETED'&&value.final_capture!==false);
    if(!capture){if(invoice.status!=='PAID'&&captures.some(value=>value.status==='PENDING')){invoice.status='PENDING';this.queue(invoice,'pending:'+order.id,'PENDING');this.store.save();}return {paid:invoice.status==='PAID',pending:invoice.status==='PENDING',invoice:this.view(invoice)};}
    if(capture.amount?.currency_code!==invoice.currency||capture.amount?.value!==(invoice.totalCents/100).toFixed(2)||captures.filter(value=>value.status==='COMPLETED').length!==1)throw new Error('Capture amount mismatch');
    if(invoice.paymentMethod==='CLIQ'||invoice.captureId&&invoice.captureId!==capture.id){this.queue(invoice,'duplicate:'+capture.id,'DUPLICATE_CAPTURE',capture.id);this.store.save();throw new Error('Duplicate capture requires review');}
    if(!['REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(invoice.status))invoice.status='PAID';
    invoice.paymentMethod=order.payment_source?.apple_pay?'APPLE_PAY':order.payment_source?.card?'CARD':order.payment_source?.paypal?'PAYPAL':invoice.checkoutMethod||'PAYPAL';invoice.captureId=capture.id;invoice.paidAt||=Date.parse(capture.create_time)||Date.now();invoice.receivable=capture.seller_receivable_breakdown||null;
    this.queue(invoice,'paid:'+capture.id,'PAID',capture.id);this.store.save();return {paid:invoice.status==='PAID',invoice:this.view(invoice)};
  }
  queue(invoice,key,type,captureId,method){if(this.store.data.paymentOutbox[key])return;this.store.data.paymentOutbox[key]={key,type,captureId,invoiceToken:invoice.token,status:['UNPAID','PAYMENT_STARTED'].includes(type)?'SKIPPED':'QUEUED',attempts:0,nextAt:Date.now(),dmStatus:invoice.customerId&&type!=='DUPLICATE_CAPTURE'?'QUEUED':'SKIPPED',dmAttempts:0,dmNextAt:Date.now(),createdAt:Date.now(),paymentMethod:method||(['CLIQ_REVIEW','CANCELLED'].includes(type)?'CLIQ':invoice.paymentMethod||invoice.checkoutMethod||'PAYPAL')};this.onNotificationQueued?.();}
  async capture(token,orderId){return this.locks.run(token,async()=>{
    const invoice=this.find(token);if(invoice.status==='PAID')return {paid:true,invoice:this.view(invoice)};
    if(!orderId||orderId!==invoice.orderId)throw Object.assign(new Error('عملية الدفع لا تخص هذه الفاتورة.'),{status:400});
    if(['CANCELLED','REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(invoice.status))throw Object.assign(new Error('هذه الفاتورة مغلقة.'),{status:409});
    let order=await this.paypal.get(orderId);if(order.status!=='COMPLETED'){if(invoice.status==='CLIQ_REVIEW')throw Object.assign(new Error('الحوالة قيد المراجعة. تواصل مع المتجر قبل الدفع مجددًا.'),{status:409});await this.paypal.capture(orderId,invoice.captureRequestId);}
    order=await this.paypal.get(orderId);return this.reconcile(invoice,order);
  });}
  async refresh(token){return this.locks.run(token,async()=>{const invoice=this.find(token);if(invoice.orderId&&['UNPAID','PENDING','CLIQ_REVIEW'].includes(invoice.status))this.reconcile(invoice,await this.paypal.get(invoice.orderId));return this.view(invoice);});}
  async webhook(headers,event){
    if(!await this.paypal.verify(headers,event))throw Object.assign(new Error('Invalid webhook signature'),{status:401});
    if(!event.id||typeof event.event_type!=='string')throw Object.assign(new Error('Invalid webhook event'),{status:400});
    if(this.store.data.paymentEvents[event.id])return;
    const orderId=event.resource?.supplementary_data?.related_ids?.order_id;
    const invoice=Object.values(this.store.data.invoices).find(value=>(value.orders||[value.orderId]).includes(orderId));
    if(invoice)await this.locks.run(invoice.token,async()=>{
      if(this.store.data.paymentEvents[event.id])return;
      const order=await this.paypal.get(orderId);
      if(['PAYMENT.CAPTURE.COMPLETED','PAYMENT.CAPTURE.PENDING'].includes(event.event_type))this.reconcile(invoice,order);
      if(['PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'].includes(event.event_type)){
        const capture=order.purchase_units?.[0]?.payments?.captures?.find(value=>value.id===invoice.captureId);
        const relatedCapture=event.resource?.supplementary_data?.related_ids?.capture_id||event.resource?.id;
        if(!capture||relatedCapture!==invoice.captureId)throw new Error('Refund capture mismatch');
        invoice.status=event.event_type.endsWith('REVERSED')?'REVERSED':capture.status==='REFUNDED'?'REFUNDED':'PARTIALLY_REFUNDED';this.queue(invoice,event.id,invoice.status,invoice.captureId);
      }
      if(event.event_type==='PAYMENT.CAPTURE.DENIED'&&invoice.status==='PENDING'){invoice.status='UNPAID';this.queue(invoice,event.id,'PAYMENT_DENIED');}
      this.store.data.paymentEvents[event.id]={at:Date.now(),type:event.event_type};this.store.save();
    });
  }
  notifications(transport=fetch,sendCustomer=this.sendCustomer){return require('./invoice-notifications').notifications.call(this,transport,sendCustomer);}
}
module.exports={Invoices,price};
