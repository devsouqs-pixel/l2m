const states={
  UNPAID:{title:'✦ فاتورتك جاهزة',label:'بانتظار الدفع',description:'جهّزنا فاتورتك. افتح رابط الدفع واختر الطريقة المناسبة لإتمام طلبك.',color:0x00E6A8},
  PAYMENT_STARTED:{title:'◈ بدأت عملية الدفع',label:'الدفع جارٍ',description:'بدأت محاولة الدفع. سنرسل لك تحديثًا عند تأكيد العملية أو تغيّر حالتها.',color:0xE9BE6B},
  CLIQ_REVIEW:{title:'◷ حوالة CliQ بانتظار المراجعة',label:'بانتظار مراجعة الإدارة',description:'وصلنا إشعارك بأنك حوّلت المبلغ. ننتظر مراجعة وصول الحوالة إلى البنك، وسنخبرك بنتيجة المراجعة. لا تحوّل مرة ثانية.',color:0xE9BE6B},
  PENDING:{title:'◷ دفعتك قيد التأكيد',label:'بانتظار تأكيد مزوّد الدفع',description:'العملية قيد المعالجة لدى مزوّد الدفع. انتظر التأكيد النهائي قبل إعادة الدفع.',color:0xE9BE6B},
  PAID:{title:'✓ تم تأكيد دفعتك بنجاح',label:'تم الدفع والتأكيد',description:'تم اعتماد دفعتك وتحديث فاتورتك. شكرًا لثقتك فينا؛ إيصالك جاهز من صفحة الفاتورة.',color:0x00E6A8},
  PAYMENT_CANCELLED:{title:'↩ تم إلغاء محاولة الدفع',label:'محاولة ملغاة',description:'تم إغلاق أو إلغاء محاولة الدفع ولم يتم تأكيد دفعة. يمكنك فتح فاتورتك والمحاولة مجددًا.',color:0xF26B7C},
  PAYMENT_FAILED:{title:'! لم تكتمل محاولة الدفع',label:'لم يتم تأكيد الدفع',description:'تعذّر إتمام محاولة الدفع. يمكنك إعادة المحاولة من الفاتورة أو التواصل مع فريق المتجر.',color:0xF26B7C},
  PAYMENT_DENIED:{title:'! لم تُعتمد الدفعة',label:'رفض مزوّد الدفع العملية',description:'لم يعتمد مزوّد الدفع العملية. راجع وسيلة الدفع أو تواصل مع المتجر قبل المحاولة مجددًا.',color:0xF26B7C},
  CANCELLED:{title:'× تم إلغاء الفاتورة',label:'ألغتها إدارة المتجر',description:'ألغت إدارة المتجر الفاتورة ولم تعتمد حوالة CliQ. إذا حوّلت المبلغ بالفعل، تواصل معنا لمراجعة الحوالة.',color:0xF26B7C},
  REFUNDED:{title:'↩ تم استرداد الدفعة',label:'تم الاسترداد',description:'تم تحديث الفاتورة بعد تأكيد استرداد الدفعة من مزوّد الدفع.',color:0xE9BE6B},
  PARTIALLY_REFUNDED:{title:'↩ تم استرداد جزء من الدفعة',label:'استرداد جزئي',description:'تم تأكيد استرداد جزئي. تواصل مع المتجر لمعرفة تفاصيل المبلغ المسترد.',color:0xE9BE6B},
  REVERSED:{title:'! تم عكس الدفعة',label:'تم عكس الدفعة لدى المزوّد',description:'تغيّرت حالة الدفعة لدى مزوّد الدفع. تواصل مع المتجر لمراجعة تفاصيل طلبك.',color:0xF26B7C},
  DUPLICATE_CAPTURE:{title:'! دفعة إضافية تحتاج مراجعة',label:'مراجعة دفعة مكررة',description:'وصل تأكيد دفعة إضافية لهذه الفاتورة. راجع سجل الدفعات قبل اتخاذ أي إجراء.',color:0xF26B7C}
};
const methods={PAYPAL:'PayPal',CARD:'بطاقة بنكية · Visa / Mastercard',APPLE_PAY:'Apple Pay',CLIQ:'CliQ · البنك العربي'};
const clip=(value,max=1000)=>String(value||'—').slice(0,max);
function payload(invoice,job,config,staff=false){
  const state=states[job.type]||states.PAYMENT_FAILED,method=job.paymentMethod||invoice.paymentMethod||'PAYPAL',cliq=method==='CLIQ'&&invoice.cliq;
  const money=cents=>(cents/100).toFixed(2)+' '+invoice.currency,url=config.checkout.publicUrl+'/invoice/'+invoice.token;
  const logo=/^https:\/\//.test(config.brand.logoUrl||'')?config.brand.logoUrl:new URL(config.checkout.logoPath||'/assets/logo.png',config.checkout.publicUrl).href;
  const e={title:state.title,description:state.description,color:state.color,author:{name:clip(config.brand.name,256),icon_url:logo},thumbnail:{url:logo},url,fields:[
    {name:'رقم الطلب / الفاتورة',value:'`'+invoice.id+'`'},
    {name:'تفاصيل الطلب',value:clip(invoice.name)},
    {name:'قيمة الطلب',value:money(invoice.baseCents),inline:true},
    {name:clip(config.checkout.fee.label,256),value:cliq?'0.000 JOD':money(invoice.feeCents),inline:true},
    {name:'الإجمالي',value:cliq?(invoice.cliq.amountFils/1000).toFixed(3)+' JOD':money(invoice.totalCents),inline:true},
    {name:'وسيلة الدفع',value:job.type==='UNPAID'?'تُحدَّد من صفحة الدفع':methods[method]||'PayPal',inline:true},
    {name:'الحالة',value:state.label,inline:true}
  ],footer:{text:clip(config.brand.name+' · تحديثات طلبك',2048)},timestamp:new Date(job.createdAt||job.sentAt||Date.now()).toISOString()};
  if(job.captureId&&method!=='CLIQ')e.fields.push({name:'مرجع الدفع',value:clip(job.captureId)});
  if(staff&&invoice.customerId)e.fields.push({name:'العميل',value:'<@'+invoice.customerId+'>'});
  if(staff&&job.type==='CLIQ_REVIEW'){
    e.description='العميل ضغط «حوّلت المبلغ». هذا إشعار للمراجعة؛ وصول الحوالة إلى البنك لم يُؤكَّد بعد.';
    e.fields.push({name:'الإجراء المطلوب بعد مراجعة البنك',value:'`/invoice-confirm invoice:'+invoice.id+' action:confirm`\nأو للإلغاء:\n`/invoice-confirm invoice:'+invoice.id+' action:cancel`'});
  }
  if(staff&&job.type==='CANCELLED'&&invoice.cancelledBy)e.fields.push({name:'ألغيت بواسطة',value:'<@'+invoice.cancelledBy+'>'});
  if(staff&&job.type==='PAID'&&method==='CLIQ'&&invoice.confirmedBy)e.fields.push({name:'اعتمدت بواسطة',value:'<@'+invoice.confirmedBy+'>'});
  const result={allowedMentions:{parse:[]},embeds:[e]};
  if(!staff)result.components=[{type:1,components:[{type:2,style:5,label:job.type==='PAID'?'عرض الفاتورة وتحميل الإيصال':'عرض الفاتورة',url},{type:2,style:5,label:'تواصل مع المتجر',url:config.checkout.storeUrl}]}];
  return result;
}
function retry(service,job,destination,error){
  const dm=destination==='dm',count=dm?'dmAttempts':'attempts',next=dm?'dmNextAt':'nextAt',status=dm?'dmStatus':'status';
  job[count]=(job[count]||0)+1;job[next]=Date.now()+Math.min(3600000,15000*2**Math.min(job[count],8));
  if(dm&&[50007,10013].includes(Number(error.code)))job[status]='BLOCKED';
  const code=Number(error.code||error.status)||'UNAVAILABLE';job[dm?'dmLastError':'lastError']=String(code);
  service.store.save();process.stderr.write('Invoice notification '+destination+' failed ('+code+') for '+service.find(job.invoiceToken).id+'\n');
}
async function notifications(transport,sendCustomer){
  if(this.settings.preview)return;
  if(this.notifying){this.notificationsRequested=true;return;}this.notifying=true;
  try{
    const jobs=Object.values(this.store.data.paymentOutbox).filter(job=>(job.status==='QUEUED'&&job.nextAt<=Date.now()&&this.settings.discordWebhookUrl)||(job.dmStatus==='QUEUED'&&job.dmNextAt<=Date.now()&&sendCustomer)).slice(0,25);
    for(const job of jobs){
      const invoice=this.find(job.invoiceToken);
      await Promise.all([
        (async()=>{
          if(job.status!=='QUEUED'||job.nextAt>Date.now()||!this.settings.discordWebhookUrl)return;
          try{
            const url=new URL(this.settings.discordWebhookUrl);
            if(url.protocol!=='https:'||!['discord.com','discordapp.com'].includes(url.hostname)||!/^\/api\/webhooks\/\d+\/[A-Za-z0-9_.-]+$/.test(url.pathname))throw new Error('Invalid Discord payment webhook');
            url.searchParams.set('wait','true');const data=payload(invoice,job,this.config,true);
            const response=await transport(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:clip(this.config.brand.name,80),avatar_url:data.embeds[0].thumbnail.url,allowed_mentions:{parse:[]},embeds:data.embeds}),signal:AbortSignal.timeout(15000)});
            if(!response.ok)throw Object.assign(new Error('Discord notification unavailable'),{status:response.status});
            const message=await response.json();job.status='SENT';job.messageId=message.id;job.sentAt=Date.now();delete job.lastError;this.store.save();
          }catch(error){retry(this,job,'webhook',error);}
        })(),
        (async()=>{
          if(job.dmStatus!=='QUEUED'||job.dmNextAt>Date.now()||!sendCustomer)return;
          const expected={UNPAID:'UNPAID',PAYMENT_STARTED:'UNPAID',CLIQ_REVIEW:'CLIQ_REVIEW',PENDING:'PENDING',PAYMENT_CANCELLED:'UNPAID',PAYMENT_FAILED:'UNPAID',PAYMENT_DENIED:'UNPAID',PAID:'PAID'}[job.type];
          if(expected&&invoice.status!==expected){job.dmStatus='SKIPPED';this.store.save();return;}
          try{const message=await sendCustomer(invoice.customerId,payload(invoice,job,this.config));job.dmStatus='SENT';job.dmMessageId=message?.id;job.dmSentAt=Date.now();delete job.dmLastError;this.store.save();}catch(error){retry(this,job,'dm',error);}
        })()
      ]);
    }
    if(jobs.length===25)this.notificationsRequested=true;
  }finally{this.notifying=false;if(this.notificationsRequested){this.notificationsRequested=false;this.onNotificationQueued?.();}}
}
module.exports={notifications,payload};
