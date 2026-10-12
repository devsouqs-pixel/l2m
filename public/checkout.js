const $=id=>document.getElementById(id);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
const token=location.pathname.match(/^\/invoice\/([A-Za-z0-9_-]{32})$/)?.[1];
const demo=Boolean(window.L2M_PREVIEW);
let invoice,settings,selected='paypal',sceneStarted=0,sceneVersion=0,sceneBusy=false,sdkReady=false,pendingTimer;
let terminalPromise,terminal3d,receiptBusy=false,downloadTimer;
let attemptId=crypto.randomUUID();
const paymentMethod=()=>({paypal:'PAYPAL',card:'CARD',apple:'APPLE_PAY',cliq:'CLIQ'}[selected]||'PAYPAL');
function prepareTerminal(){return terminalPromise||=(import('/terminal-3d.js').then(module=>module.createTerminal($('terminal-webgl'),{brand:settings.brand,reduced})).then(terminal=>{terminal3d=terminal;$('terminal-stage').classList.add('webgl-ready');return terminal;}).catch(()=>null));}
const money=cents=>'$'+(cents/100).toFixed(2);
const isCliq=()=>Boolean(invoice.cliq&&(selected==='cliq'||invoice.paymentMethod==='CLIQ'||['CLIQ_REVIEW','CANCELLED'].includes(invoice.status)));
const paidAmount=()=>isCliq()?(invoice.cliq.amountFils/1000).toFixed(3)+' JOD':money(invoice.totalCents);
const date=value=>new Intl.DateTimeFormat('ar-JO',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value));
function error(message){$('payment-error').textContent=message;$('payment-error').hidden=false;}
function applyBrand(){
  document.querySelectorAll('.brand-name').forEach(element=>element.textContent=settings.brand.name);
  document.querySelectorAll('.brand-logo').forEach(element=>{element.src=settings.brand.logo;element.alt=settings.brand.name;});
  if(/^#[0-9a-f]{6}$/i.test(settings.brand.color)){document.documentElement.style.setProperty('--accent',settings.brand.color);document.documentElement.style.setProperty('--accent-rgb',settings.brand.color.slice(1).match(/.{2}/g).map(value=>parseInt(value,16)).join(','));}
  document.querySelectorAll('.store-link').forEach(element=>{try{const link=new URL(settings.storeUrl);if(link.protocol==='https:')element.href=link.href;}catch{}});
  document.title=(invoice?.name||'فاتورة')+' | '+settings.brand.name;$('year').textContent=new Date().getFullYear();
}
function paintInvoice(){
  $('summary-title').textContent=invoice.name;$('invoice-id').textContent=invoice.id;$('total').textContent=(invoice.totalCents/100).toFixed(2);$('total-small').textContent=money(invoice.totalCents);$('subtotal').textContent=money(invoice.baseCents);$('fee').textContent=money(invoice.feeCents);$('fee-label').textContent=invoice.feeLabel;$('created-date').textContent=date(invoice.createdAt);$('expiry-date').textContent=date(invoice.expiresAt);$('demo-total').textContent=money(invoice.totalCents)+' ↗';
  const labels={UNPAID:'بانتظار الدفع',PAID:'تم الدفع',PENDING:'قيد التأكيد',CLIQ_REVIEW:'الحوالة قيد المراجعة',CANCELLED:'تم إلغاء الفاتورة',REFUNDED:'تم الاسترداد',PARTIALLY_REFUNDED:'استرداد جزئي',REVERSED:'دفعة معكوسة'};$('invoice-status').textContent=invoice.expired?'انتهت الصلاحية':labels[invoice.status]||'بانتظار الدفع';
  document.querySelector('.dollar').textContent=isCliq()?'': '$';document.querySelector('.amount-currency').textContent=isCliq()?'JOD':'USD';
  if(isCliq()){$('total').textContent=(invoice.cliq.amountFils/1000).toFixed(3);$('total-small').textContent=paidAmount();$('fee').textContent='0.000 JOD';}
}
function finishIntro(){document.body.classList.add('ready');$('intro').classList.add('done');}
async function api(action,data={}){
  const response=await fetch('/api/invoices/'+token+(action?'/'+action:''),{method:action?'POST':'GET',headers:action?{'Content-Type':'application/json'}:{},...(action?{body:JSON.stringify(data)}:{}),cache:'no-store'});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'تعذر الاتصال بالمتجر. حاول مجددًا.');return value;
}
function choose(method){
  selected=method;$('payment-error').hidden=true;
  document.querySelectorAll('.method').forEach(element=>{const active=element.dataset.method===method;element.classList.toggle('selected',active);element.setAttribute('aria-pressed',String(active));});
  paintInvoice();$('cliq-panel').hidden=method!=='cliq';$('payment-action').hidden=method==='cliq';document.querySelector('.payment-trust').hidden=method==='cliq';
  if(demo)return;
  $('paypal-buttons').hidden=method!=='paypal';$('card-buttons').hidden=method!=='card'||settings.paypal.advancedCardsActive;$('card-fields').hidden=method!=='card'||!settings.paypal.advancedCardsActive;$('apple-button').hidden=method!=='apple';
}
function beginScene(){
  sceneVersion++;clearInterval(pendingTimer);clearTimeout(downloadTimer);sceneStarted=Date.now();sceneBusy=true;const scene=$('terminal-scene');scene.hidden=true;scene.className='terminal-scene';void scene.offsetWidth;scene.hidden=false;
  const version=sceneVersion;prepareTerminal().then(terminal=>{if(version===sceneVersion)terminal?.start({...invoice,...(isCliq()?{paymentMethod:'CLIQ'}:{})});});$('receipt-download-status').textContent='';
  document.body.style.overflow='hidden';$('result-copy').setAttribute('aria-busy','true');$('result-title').textContent='جاري تأكيد عملية الدفع';$('result-description').textContent='لحظات حتى يصل تأكيد العملية.';$('print-button').hidden=true;$('retry-button').hidden=true;
  return sceneVersion;
}
async function settleScene(kind,description,version=sceneVersion){
  await pause(reduced?0:Math.max(0,2200-(Date.now()-sceneStarted)));if(version!==sceneVersion)return;
  const success=kind==='success',pending=kind==='pending';
  const scene=$('terminal-scene');scene.classList.remove('success','pending','failure','settled');scene.classList.add(success?'success':pending?'pending':'failure','settled');
  prepareTerminal().then(terminal=>{if(version===sceneVersion)terminal?.finish(kind,{...invoice,...(isCliq()?{paymentMethod:'CLIQ'}:{})});});
  $('screen-result-label').textContent=success?'APPROVED':pending?'PROCESSING':kind==='cancel'?'CANCELLED':'NOT COMPLETED';$('screen-amount').textContent=money(invoice.totalCents);$('screen-ref').textContent=success?'TRANSACTION COMPLETE':pending?'AWAITING CONFIRMATION':'NO PAYMENT CONFIRMED';
  $('result-kicker').textContent=success?'PAYMENT CONFIRMED':pending?'CONFIRMATION IN PROGRESS':kind==='cancel'?'PAYMENT CANCELLED':'PAYMENT NOT COMPLETED';
  $('result-title').textContent=success?'وصلت. ومبروك طلبك!':pending?'دفعتك قيد التأكيد.':invoice.status==='CANCELLED'?'تم إلغاء الفاتورة.':kind==='cancel'?'وقفت العملية؟ ولا يهمك.':'ما اكتمل الدفع.';
  $('result-description').textContent=description||(success?'تم دفع قيمة الطلب بنجاح. احتفظ بإيصالك للرجوع إليه.':pending?'لم يصل تأكيد نهائي بعد. سيتم تحديث الفاتورة بعد التأكد.':'لم يتم تأكيد دفع قيمة الطلب. تقدر ترجع للفاتورة وتحاول مرة ثانية.');
  $('receipt-result').textContent=success?'تم الدفع بنجاح':'لم يتم تأكيد الدفع';$('receipt-name').textContent=invoice.name;$('receipt-id').textContent=invoice.id;$('receipt-date').textContent=date(invoice.paidAt||Date.now());$('receipt-total').textContent=money(invoice.totalCents);$('receipt-thanks').textContent=success?'شكرًا لثقتك فينا ♡':'محاولة غير مكتملة · ليست فاتورة مدفوعة';$('result-reference').textContent=invoice.id+(demo?' · PREVIEW':invoice.paymentReference&&invoice.paymentReference!==invoice.id?' · '+invoice.paymentReference:invoice.captureId?' · '+invoice.captureId:'');
  $('print-button').hidden=!success;$('retry-button').hidden=success||invoice.status==='CANCELLED';$('retry-button').textContent=pending?'تحديث حالة الدفع ↻':'العودة للفاتورة ↻';$('result-copy').setAttribute('aria-busy','false');sceneBusy=false;$('retry-button').disabled=false;
  if(success)downloadTimer=setTimeout(async()=>{if(version!==sceneVersion)return;let downloaded=false;try{downloaded=sessionStorage.getItem('receipt:'+invoice.id)==='1';}catch{}if(!downloaded)await saveReceipt();},reduced?100:3200);
  $('screen-amount').textContent=paidAmount();$('receipt-total').textContent=paidAmount();
  if(pending&&!demo){let polling=false;pendingTimer=setInterval(async()=>{if(polling||version!==sceneVersion)return;polling=true;try{const result=await api('refresh');if(version!==sceneVersion)return;invoice=result.invoice;paintInvoice();if(invoice.status==='PAID'){clearInterval(pendingTimer);await settleScene('success',undefined,version);}else if(invoice.status==='CANCELLED'){clearInterval(pendingTimer);await settleScene('cancel','ألغت إدارة المتجر الفاتورة. إذا حوّلت المبلغ، تواصل معنا لمراجعة الحوالة.',version);}else if(!['PENDING','CLIQ_REVIEW'].includes(invoice.status)){clearInterval(pendingTimer);await settleScene('failure','لم يعتمد مزوّد الدفع العملية. راجع حالة الدفعة أو تواصل مع المتجر.',version);}}catch{}finally{polling=false;}},5000);}
  setTimeout(()=>{if(version===sceneVersion)($('retry-button').hidden?scene.querySelector('.store-link'):$('retry-button')).focus({preventScroll:true});},reduced?0:1000);
}
async function reportAttempt(kind){if(demo||!token||invoice.status!=='UNPAID')return;const result=await api('attempt',{kind,method:paymentMethod(),attemptId});invoice=result.invoice;paintInvoice();}
async function outcome(kind,description){const version=beginScene();if(['cancel','failure'].includes(kind)&&!demo){try{await reportAttempt(kind);if(invoice.status==='PAID'){kind='success';description=undefined;}else if(['PENDING','CLIQ_REVIEW'].includes(invoice.status)){kind='pending';description=undefined;}}catch{}}await settleScene(kind,description,version);}
async function capture(orderId){
  const version=beginScene();
  try{const result=await api('capture',{orderId});invoice=result.invoice;paintInvoice();await settleScene(result.paid?'success':result.pending?'pending':'failure',undefined,version);}
  catch(problem){try{await reportAttempt('failure');}catch{}await settleScene(invoice.status==='PAID'?'success':['PENDING','CLIQ_REVIEW'].includes(invoice.status)?'pending':'failure',invoice.status==='UNPAID'?problem.message:undefined,version);}
}
function loadScript(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=()=>reject(new Error('تعذر تحميل خدمة الدفع. حدّث الصفحة وحاول مجددًا.'));document.head.append(script);});}
async function setupApple(){
  const button=document.querySelector('[data-method="apple"]');
  $('apple-description').textContent='غير متاح حاليًا';
  if(settings.paypal.applePay&&!window.ApplePaySession)try{await loadScript('https://applepay.cdn-apple.com/jsapi/1.latest/apple-pay-sdk.js');}catch{}
  if(!settings.paypal.applePay||!window.ApplePaySession||!ApplePaySession.canMakePayments()||!window.paypal?.Applepay)return;
  try{
    const apple=paypal.Applepay(),config=await apple.config();if(!config.isEligible)return;
    button.disabled=false;$('apple-description').textContent='دفع سريع من جهازك';
    $('apple-button').onclick=()=>{
      const session=new ApplePaySession(4,{countryCode:config.countryCode,currencyCode:invoice.currency,merchantCapabilities:config.merchantCapabilities,supportedNetworks:config.supportedNetworks,requiredBillingContactFields:['postalAddress'],total:{label:settings.brand.name,amount:(invoice.totalCents/100).toFixed(2),type:'final'}});
      session.onvalidatemerchant=async event=>{try{const result=await apple.validateMerchant({validationUrl:event.validationURL,displayName:settings.brand.name});session.completeMerchantValidation(result.merchantSession);}catch{session.abort();outcome('failure','تعذر فتح Apple Pay. اختر وسيلة دفع أخرى.');}};
      session.onpaymentauthorized=async event=>{try{attemptId=crypto.randomUUID();const order=await api('order',{method:'APPLE_PAY'});if(order.paid){session.completePayment(ApplePaySession.STATUS_SUCCESS);invoice=order.invoice;paintInvoice();return outcome('success');}await apple.confirmOrder({orderId:order.id,token:event.payment.token,billingContact:event.payment.billingContact});session.completePayment(ApplePaySession.STATUS_SUCCESS);await capture(order.id);}catch(problem){session.completePayment(ApplePaySession.STATUS_FAILURE);outcome('failure',problem.message);}};
      session.oncancel=()=>outcome('cancel');session.begin();
    };
  }catch{}
}
async function setupPayments(){
  if(demo){$('loading-payment').hidden=true;$('demo-pay').hidden=false;$('preview-tools').hidden=false;document.querySelectorAll('.method').forEach(button=>button.disabled=false);$('apple-description').textContent='معاينة تجربة Apple Pay';$('demo-pay').onclick=()=>outcome('success');return;}
  if(invoice.status==='PAID'){ $('loading-payment').hidden=true;return outcome('success');}
  if(['PENDING','CLIQ_REVIEW'].includes(invoice.status)){ $('loading-payment').hidden=true;return outcome('pending',invoice.status==='CLIQ_REVIEW'?'وصل إشعار التحويل للمتجر. ننتظر مراجعة وصول المبلغ إلى البنك؛ لا تحوّل مرة أخرى.':undefined);}
  if(invoice.status==='CANCELLED'){$('loading-payment').hidden=true;document.querySelectorAll('.method').forEach(button=>button.disabled=true);return outcome('cancel','ألغت إدارة المتجر الفاتورة. إذا حوّلت المبلغ، تواصل معنا لمراجعة الحوالة.');}
  if(invoice.expired||['REFUNDED','PARTIALLY_REFUNDED','REVERSED'].includes(invoice.status)){$('loading-payment').hidden=true;document.querySelectorAll('.method').forEach(button=>button.disabled=true);return error(invoice.expired?'انتهت صلاحية الفاتورة. تواصل مع المتجر للحصول على رابط جديد.':'هذه الفاتورة مغلقة. تواصل مع المتجر لأي استفسار.');}
  if(!settings.paypal.configured){$('loading-payment').hidden=true;document.querySelectorAll('.method:not([data-method="cliq"])').forEach(button=>button.disabled=true);if(invoice.cliq)return choose('cliq');return error('الدفع غير مفعّل حاليًا. تواصل مع المتجر.');}
  const query=new URLSearchParams({'client-id':settings.paypal.clientId,currency:invoice.currency,intent:'capture',components:'buttons,card-fields,applepay',commit:'true',locale:'en_US','enable-funding':'card'});
  await loadScript('https://www.paypal.com/sdk/js?'+query);sdkReady=true;
  const callbacks={createOrder:async()=>{attemptId=crypto.randomUUID();const order=await api('order',{method:paymentMethod()});if(order.paid){invoice=order.invoice;paintInvoice();await outcome('success');throw new Error('Already paid');}return order.id;},onApprove:data=>capture(data.orderID),onCancel:()=>outcome('cancel'),onError:()=>outcome('failure','تعذر إكمال الدفع. راجع حالة العملية أو تواصل مع المتجر قبل إعادة المحاولة.')};
  const buttons=paypal.Buttons({...callbacks,fundingSource:paypal.FUNDING.PAYPAL,style:{layout:'vertical',color:'gold',shape:'rect',label:'pay',height:49,tagline:false}});
  if(buttons.isEligible())await buttons.render('#paypal-buttons');else error('الدفع عبر PayPal غير متاح حاليًا.');
  let cardsActive=false;
  if(settings.paypal.advancedCards&&paypal.CardFields){
    const fields=paypal.CardFields({...callbacks,style:{input:{color:'#e5eef0','font-family':'sans-serif','font-size':'15px','padding':'12px'},'.invalid':{color:'#ff7386'}}});
    if(fields.isEligible()){await Promise.all([fields.NameField().render('#card-name'),fields.NumberField().render('#card-number'),fields.ExpiryField().render('#card-expiry'),fields.CVVField().render('#card-cvv')]);settings.paypal.advancedCardsActive=true;cardsActive=true;$('submit-card').onclick=async()=>{try{attemptId=crypto.randomUUID();$('submit-card').disabled=true;await fields.submit();}catch{try{await reportAttempt('failure');}catch{}error('تحقق من بيانات البطاقة وحاول مجددًا.');}finally{$('submit-card').disabled=false;}};}
  }
  if(!cardsActive){const cards=paypal.Buttons({...callbacks,fundingSource:paypal.FUNDING.CARD,style:{layout:'vertical',color:'black',shape:'rect',height:49,tagline:false}});if(cards.isEligible()){await cards.render('#card-buttons');cardsActive=true;$('card-description').textContent='عبر صفحة PayPal الآمنة';}}
  document.querySelector('[data-method="card"]').disabled=!cardsActive;if(!cardsActive)$('card-description').textContent='غير متاح حاليًا';
  $('loading-payment').hidden=true;choose(selected);await setupApple();
}
document.querySelectorAll('.method').forEach(button=>button.addEventListener('click',()=>choose(button.dataset.method)));
$('demo-success').onclick=()=>outcome('success');$('demo-cancel').onclick=()=>outcome('cancel');$('demo-pending').onclick=()=>outcome('pending');
$('replay-intro').onclick=async()=>{sceneVersion++;clearTimeout(downloadTimer);clearInterval(pendingTimer);terminal3d?.stop();$('terminal-scene').hidden=true;document.body.style.overflow='';document.body.classList.remove('ready');const intro=$('intro');intro.classList.remove('done');intro.querySelectorAll('*').forEach(element=>element.getAnimations().forEach(animation=>{animation.cancel();animation.play();}));await pause(2100);finishIntro();};
$('retry-button').onclick=async()=>{if(sceneBusy)return;$('retry-button').disabled=true;try{if(!demo){const result=await api('refresh');invoice=result.invoice;paintInvoice();if(invoice.status==='PAID')return outcome('success');if(['PENDING','CLIQ_REVIEW'].includes(invoice.status))return outcome('pending');if(invoice.status==='CANCELLED')return outcome('cancel','ألغت إدارة المتجر الفاتورة. تواصل معنا لمراجعة طلبك.');}sceneVersion++;clearInterval(pendingTimer);attemptId=crypto.randomUUID();terminal3d?.stop();$('terminal-scene').hidden=true;document.body.style.overflow='';document.querySelector('[data-method="'+selected+'"]').focus();}catch(problem){$('result-description').textContent=problem.message;}finally{$('retry-button').disabled=false;}};
async function saveReceipt(){if(receiptBusy)return;receiptBusy=true;$('print-button').disabled=true;try{if(!demo){const result=await api();invoice=result.invoice;if(invoice.status!=='PAID')throw new Error('الإيصال متاح بعد تأكيد الدفع فقط.');}const module=await import('/receipt.js');await module.downloadReceipt({...invoice,...(demo&&selected==='cliq'?{paymentMethod:'CLIQ'}:{})},settings,{demo});$('receipt-download-status').textContent='تم تجهيز الإيصال. إذا لم يبدأ التنزيل اضغط تحميل الإيصال.';try{sessionStorage.setItem('receipt:'+invoice.id,'1');}catch{}}catch(problem){$('receipt-download-status').textContent=problem.message||'تعذر تحميل الإيصال. حاول مجددًا.';}finally{receiptBusy=false;$('print-button').disabled=false;}}
$('print-button').onclick=saveReceipt;
$('copy-cliq').onclick=async()=>{try{await navigator.clipboard.writeText(invoice.cliq.phone);$('copy-cliq').textContent='تم النسخ ✓';setTimeout(()=>$('copy-cliq').textContent='نسخ',2000);}catch{$('copy-cliq').textContent='انسخ الرقم يدويًا';}};
$('cliq-form').onsubmit=async event=>{event.preventDefault();$('cliq-submit').disabled=true;try{if(demo)return await outcome('pending','معاينة فقط: تنتظر هذه الحوالة مراجعة البنك من إدارة المتجر.');const result=await api('cliq-claim');invoice=result.invoice;paintInvoice();await outcome(invoice.status==='PAID'?'success':'pending',invoice.status==='PAID'?undefined:'وصل طلبك للمتجر وهو بانتظار مراجعة البنك. ستتحدث الصفحة تلقائيًا بعد التأكيد أو الإلغاء. لا تحوّل مرة أخرى.');}catch(problem){error(problem.message);}finally{$('cliq-submit').disabled=false;}};
document.addEventListener('keydown',event=>{const scene=$('terminal-scene');if(scene.hidden||event.key!=='Tab')return;const focusable=[...scene.querySelectorAll('a[href],button:not([disabled])')].filter(element=>!element.hidden);const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}});
async function start(){
  const beginning=Date.now();
  try{
    if(!demo&&!token){$('checkout').hidden=true;$('empty-state').hidden=false;settings={brand:{name:'',color:'#ffffff',logo:'/assets/logo.png'},storeUrl:'https://discord.gg/SJ6vDZWWf6'};applyBrand();return;}
    const data=demo?window.L2M_PREVIEW:await api();invoice=data.invoice;settings=data.settings;applyBrand();paintInvoice();
    void prepareTerminal();const cliq=document.querySelector('[data-method="cliq"]');document.querySelector('.methods').append(cliq);cliq.hidden=!invoice.cliq;
    if(invoice.cliq){$('cliq-amount').textContent=(invoice.cliq.amountFils/1000).toFixed(3)+' JOD';$('cliq-bank').textContent=invoice.cliq.bank;$('cliq-phone').textContent=invoice.cliq.phone;$('cliq-note').textContent=invoice.id;$('beneficiary-row').hidden=!invoice.cliq.beneficiaryName;$('cliq-beneficiary').textContent=invoice.cliq.beneficiaryName;$('cliq-beneficiary-hint').textContent=invoice.cliq.beneficiaryLastName||'FOUDEH';if(invoice.paymentMethod==='CLIQ'||['CLIQ_REVIEW','CANCELLED'].includes(invoice.status))choose('cliq');}
    if(!demo&&['UNPAID','PENDING'].includes(invoice.status)){try{const result=await api('refresh');invoice=result.invoice;paintInvoice();}catch{}}
    await pause(reduced?0:Math.max(0,1900-(Date.now()-beginning)));finishIntro();
    const params=new URLSearchParams(location.search);
    if(!demo&&params.has('PayerID')&&params.has('token')&&invoice.status!=='PAID'){history.replaceState({},'',location.pathname);return capture(params.get('token'));}
    await setupPayments();
    if(!demo&&params.get('cancel')==='1'&&invoice.status==='UNPAID'){history.replaceState({},'',location.pathname);await outcome('cancel');}
  }catch(problem){if(!invoice){$('checkout').hidden=true;$('empty-state').hidden=false;$('empty-message').textContent=problem.message;}else{$('loading-payment').hidden=true;error(problem.message);}}finally{await pause(reduced?0:Math.max(0,1900-(Date.now()-beginning)));finishIntro();}
}
start();
