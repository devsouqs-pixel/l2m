const {PermissionFlagsBits,UserSelectMenuBuilder}=require('discord.js');
const {Store,Locks,id}=require('./store');
const {embed,button,row,clip}=require('./ui');
class App {
  constructor(client,store,config) {
    this.client=client;this.store=store;this.config=config;this.startedAt=Date.now();
    this.sessions=new Map();this.warningCooldown=new Map();this.actionLocks=new Locks();
    for(const job of Object.values(store.data.broadcasts)) for(const recipient of job.recipients) if(recipient.status==='SENDING') recipient.status='UNKNOWN';
    this.store.save();
  }
  isStaffMember(m){return Boolean(m?.permissions?.has(PermissionFlagsBits.Administrator)||this.config.staffRoleIds.some(r=>m?.roles?.cache?.has(r)));}
  staff(i){return Boolean(i.inGuild()&&this.isStaffMember(i.member));}
  requireStaff(i){if(!this.staff(i))throw new Error('هذا الأمر مخصص لإدارة المتجر.');}
  async member(i,userId){const m=await i.guild.members.fetch(userId);if(m.user.bot)throw new Error('اختر عضوًا من السيرفر.');return m;}
  session(i,value){const sid=id();this.sessions.set(sid,{...value,owner:i.user.id,guildId:i.guildId,expires:Date.now()+14*60000});return sid;}
  getSession(i,sid){const s=this.sessions.get(sid);if(!s||s.owner!==i.user.id||s.guildId!==i.guildId||Date.now()>s.expires)throw new Error('انتهت صلاحية المعاينة. افتح الأمر من جديد.');return s;}
  reply(i,payload){return i.reply({...payload,ephemeral:true,allowedMentions:{parse:[]}});}
  customerView(i,userId,page=1){
    const p=this.store.customer(i.guildId,userId);this.store.save();
    const pages=Math.max(1,Math.ceil(p.products.length/5));page=Math.max(1,Math.min(page,pages));
    const e=embed(this.config,'Customer Profile • ملف العميل',`<@${userId}>\nالمنتجات المسجلة: **${p.products.length}**`);
    for(const item of p.products.slice((page-1)*5,page*5))e.addFields({name:clip(item.name,120),value:clip(`ID: \`${item.id}\`\n${item.details||'منتج مسجل يدويًا'}`,600)});
    if(this.staff(i)&&p.notes)e.addFields({name:'ملاحظة إدارية',value:clip(p.notes)});
    return {embeds:[e],components:[row(button(`customer:${userId}:${page-1}`,'السابق').setDisabled(page===1),button(`customer:${userId}:${page+1}`,`التالي • ${page}/${pages}`).setDisabled(page===pages))]};
  }
  panelView(i){
    const guild=i.guildId,customers=Object.values(this.store.data.customers).filter(x=>x.guildId===guild).length;
    const giveaways=Object.values(this.store.data.giveaways).filter(x=>x.guildId===guild&&x.status==='RUNNING').length;
    const broadcasts=Object.values(this.store.data.broadcasts).filter(x=>x.guildId===guild&&x.status==='RUNNING').length;
    return {embeds:[embed(this.config,'L2M Control Center','لوحة الإدارة داخل الديسكورد').addFields(
      {name:'العملاء',value:String(customers),inline:true},{name:'السحوبات النشطة',value:String(giveaways),inline:true},{name:'البرودكاست النشط',value:String(broadcasts),inline:true}
    )],components:[
      row(button('panel:customers','العملاء',1),button('panel:addproduct','إضافة منتج'),button('panel:message','محرر الرسائل'),button('panel:dm','رسالة خاصة')),
      row(button('panel:broadcast','برودكاست'),button('panel:giveaway','سحب مجاني'),button('panel:poll','تصويت'),button('panel:refresh','تحديث'))
    ]};
  }
  helpView(i){
    const common='`/feedback` تقييم ونشره بعد معاينة • `/customer` عرض ملفك • `/notifications` إيقاف أو تشغيل رسائل البرودكاست';
    const staff='\n\n**الإدارة**\n`/panel` لوحة التحكم • `/message` محرر إيمبدات • `/dm` رسالة خاصة\n`/broadcast` و`/broadcast-status` و`/broadcast-stop`\n`/customer-add` و`/customer-remove` و`/role`\n`/feedback-setup` • `/giveaway` و`/giveaway-end` • `/poll` و`/poll-end`';
    return {embeds:[embed(this.config,'دليل أوامر المتجر',common+(this.staff(i)?staff:''))]};
  }
  async control(i,parts){
    this.requireStaff(i);const [prefix,action,sid]=parts;
    if(prefix==='panel'){
      if(action==='refresh')return i.update(this.panelView(i));
      if(['customers','addproduct','dm'].includes(action))return i.update({content:'اختر العضو:',embeds:[],components:[row(new UserSelectMenuBuilder().setCustomId(`paneluser:${action}`).setPlaceholder('اختر العضو').setMaxValues(1)),row(button('panel:refresh','رجوع'))]});
      if(['message','broadcast'].includes(action))return this.startEditor(i,action,null,i.channelId);
      if(['giveaway','poll'].includes(action))return i.update({content:`استخدم أمر /${action} لتحديد تفاصيل ${action==='giveaway'?'السحب':'التصويت'} ثم نشره.`,embeds:[],components:[row(button('panel:refresh','رجوع'))]});
    }
    if(prefix==='paneluser'){
      const userId=i.values[0];
      if(action==='customers')return i.update(this.customerView(i,userId));
      if(action==='dm')return this.startEditor(i,'dm',userId,i.channelId);
      const key=this.session(i,{kind:'product',userId});
      return i.showModal(require('./ui').modal(`productmodal:${key}`,'إضافة منتج',[
        {id:'name',label:'اسم المنتج',max:120},{id:'details',label:'تفاصيل المنتج',long:true,max:500,required:false}
      ]));
    }
    if(prefix==='productmodal'){
      const s=this.getSession(i,action),member=await this.member(i,s.userId);
      const name=i.fields.getTextInputValue('name').trim(),details=i.fields.getTextInputValue('details').trim();
      if(!name)throw new Error('اسم المنتج مطلوب.');
      this.store.customer(i.guildId,member.id).products.push({id:id(),name,details,createdAt:new Date().toISOString(),addedBy:i.user.id});
      this.store.audit(i.guildId,i.user.id,'customer.add',member.id);this.sessions.delete(action);
      return this.reply(i,this.customerView(i,member.id));
    }
  }
  async dispatch(i){
    if(i.isButton()&&i.customId.startsWith('optout:')){
      const guildId=i.customId.split(':')[1];this.store.data.optouts[`${guildId}:${i.user.id}`]=true;this.store.save();
      return this.reply(i,{content:'تم إيقاف رسائل البرودكاست لك. يمكنك تفعيلها من /notifications داخل السيرفر.'});
    }
    if(!i.inGuild())return this.reply(i,{content:'استخدم الأمر داخل سيرفر المتجر.'});
    if(this.config.guildId&&i.guildId!==this.config.guildId)return this.reply(i,{content:'هذا البوت مخصص لسيرفر المتجر.'});
    if(i.isChatInputCommand()){
      const n=i.commandName,o=i.options;
      if(n==='help')return this.reply(i,this.helpView(i));
      if(n==='notifications'){
        this.store.data.optouts[`${i.guildId}:${i.user.id}`]=!o.getBoolean('enabled');this.store.save();
        return this.reply(i,{content:o.getBoolean('enabled')?'تم تفعيل الرسائل.':'تم إيقاف الرسائل.'});
      }
      if(n==='customer'){
        const target=o.getUser('user')?.id||i.user.id;
        if(target!==i.user.id&&!this.staff(i))throw new Error('يمكنك عرض ملفك فقط.');
        return this.reply(i,this.customerView(i,target,o.getInteger('page')||1));
      }
      if(['feedback','feedback-setup','giveaway','giveaway-end','poll','poll-end'].includes(n))return this.communityCommand(i);
      this.requireStaff(i);
      if(n==='invoice-confirm'){
        await i.deferReply({ephemeral:true});const action=o.getString('action'),invoice=await this.invoices.confirmCliq({id:o.getString('invoice').trim().toUpperCase(),action,guildId:i.guildId,staffId:i.user.id});
        return i.editReply({embeds:[embed(this.config,action==='confirm'?'✓ تم اعتماد حوالة CliQ':'× تم إلغاء الفاتورة',`الفاتورة: **${invoice.id}**\nالطلب: **${invoice.name}**\nالمبلغ: **${(invoice.cliq.amountFils/1000).toFixed(3)} JOD**\nتم تحديث صفحة الفاتورة وإضافة إشعار الإدارة ورسالة العميل للإرسال.`).setColor(action==='confirm'?this.config.brand.color:'#F26B7C')],allowedMentions:{parse:[]}});
      }
      if(n==='invoice'){
        await i.deferReply();
        const customer=o.getUser('user');if(!customer)throw new Error('حدد العميل في خيار user حتى تصله تحديثات الفاتورة.');await this.member(i,customer.id);
        const invoice=this.invoices.create({amount:o.getString('amount'),name:o.getString('name'),customerId:customer?.id,createdBy:i.user.id,guildId:i.guildId,channelId:i.channelId});
        const money=cents=>`$${(cents/100).toFixed(2)}`;
        const e=embed(this.config,'فاتورة دفع • '+invoice.id,`**${invoice.name}**\n${customer?'فاتورة للعميل <@'+customer.id+'>\n':''}اضغط «عرض الفاتورة والدفع» لإتمام طلبك.`).addFields({name:'قيمة الطلب',value:money(invoice.baseCents),inline:true},{name:this.config.checkout.fee.label,value:money(invoice.feeCents),inline:true},{name:'الإجمالي المستحق',value:money(invoice.totalCents),inline:true},{name:'صلاحية الرابط',value:`<t:${Math.floor(invoice.expiresAt/1000)}:R>`}).setFooter({text:this.config.brand.name+' • Secure checkout'});
        const {ButtonBuilder,ButtonStyle}=require('discord.js');
        const link=new ButtonBuilder().setLabel('عرض الفاتورة والدفع').setStyle(ButtonStyle.Link).setURL(this.config.checkout.publicUrl+'/invoice/'+invoice.token);
        const message=await i.editReply({embeds:[e],components:[row(link)],allowedMentions:{parse:[]}});invoice.discordMessageId=message.id;this.store.save();return;
      }
      if(n==='panel')return this.reply(i,this.panelView(i));
      if(['message','dm','broadcast'].includes(n))return this.startEditor(i,n,o.getUser('user')?.id,o.getChannel('channel')?.id);
      if(n==='broadcast-status'||n==='broadcast-stop'){
        const job=this.store.data.broadcasts[o.getString('id')];if(!job||job.guildId!==i.guildId)throw new Error('المعرف غير موجود.');
        if(n==='broadcast-stop'){job.status='STOPPED';this.store.audit(i.guildId,i.user.id,'broadcast.stop',job.id);}
        return this.reply(i,this.broadcastView(job));
      }
      if(n==='customer-add'){
        const userId=o.getUser('user').id;await this.member(i,userId);
        const p=this.store.customer(i.guildId,userId);
        p.products.push({id:id(),name:o.getString('product'),details:o.getString('details')||'',createdAt:new Date().toISOString(),addedBy:i.user.id});
        this.store.audit(i.guildId,i.user.id,'customer.add',userId);return this.reply(i,this.customerView(i,userId));
      }
      if(n==='customer-remove'){
        const userId=o.getUser('user').id,p=this.store.customer(i.guildId,userId),key=o.getString('product-id');
        if(!p.products.some(x=>x.id===key))throw new Error('معرف المنتج غير موجود.');
        const sid=this.session(i,{kind:'remove',userId,productId:key});
        return this.reply(i,{content:'تأكيد حذف المنتج من الملف؟',components:[row(button(`remove:${sid}`,'تأكيد',4),button(`discard:${sid}`,'إلغاء'))]});
      }
      if(n==='role'){
        await i.deferReply({ephemeral:true});
        const member=await this.member(i,o.getUser('user').id),role=await i.guild.roles.fetch(o.getRole('role').id);
        const actor=await i.guild.members.fetch(i.user.id),me=await i.guild.members.fetchMe();
        if(!actor.permissions.has(PermissionFlagsBits.ManageRoles)||!me.permissions.has(PermissionFlagsBits.ManageRoles))throw new Error('تحتاج صلاحية Manage Roles للبوت والموظف.');
        if(!role||role.managed||role.id===i.guildId||me.roles.highest.comparePositionTo(role)<=0)throw new Error('يجب أن تكون رتبة البوت أعلى من الرتبة المطلوبة.');
        if(i.guild.ownerId!==i.user.id&&actor.roles.highest.comparePositionTo(role)<=0)throw new Error('لا يمكنك منح رتبة أعلى من رتبتك.');
        if(this.config.assignableRoleIds.length&&!this.config.assignableRoleIds.includes(role.id))throw new Error('الرتبة غير موجودة في assignableRoleIds.');
        if(!actor.permissions.has(PermissionFlagsBits.Administrator)&&role.permissions.toArray().some(p=>!actor.permissions.has(p)))throw new Error('لا يمكنك منح صلاحيات لا تملكها.');
        await member.roles.add(role);this.store.audit(i.guildId,i.user.id,'role.add',`${member.id}:${role.id}`);
        return i.editReply(`تمت إضافة <@&${role.id}> إلى <@${member.id}>.`);
      }
      return this.reply(i,{content:'استخدم /help لعرض الأوامر.'});
    }
    const parts=i.customId.split(':'),prefix=parts[0];
    if(prefix==='customer'){
      const userId=parts[1];if(!this.staff(i)&&i.user.id!==userId)throw new Error('الملف خاص بصاحبه.');
      return i.update(this.customerView(i,userId,Number(parts[2])));
    }
    if(prefix==='discard'){this.getSession(i,parts[1]);this.sessions.delete(parts[1]);return i.update({content:'تم الإغلاق.',embeds:[],components:[]});}
    if(prefix==='remove'){
      this.requireStaff(i);const s=this.getSession(i,parts[1]);
      const p=this.store.customer(i.guildId,s.userId);p.products=p.products.filter(v=>v.id!==s.productId);
      this.sessions.delete(parts[1]);this.store.audit(i.guildId,i.user.id,'customer.remove',s.productId);
      return i.update({content:'تم حذف المنتج المسجل.',embeds:[],components:[]});
    }
    if(['edit','editmodal','audience'].includes(prefix))return this.messagingComponent(i,parts);
    if(['feedbackmodal','feedbackconfirm','feedbackedit'].includes(prefix))return this.feedbackComponent(i,parts);
    if(['giveaway','poll'].includes(prefix))return this.communityComponent(i,parts);
    if(['panel','paneluser','productmodal'].includes(prefix))return this.control(i,parts);
    return this.reply(i,{content:'هذه الرسالة قديمة. افتح الأمر من جديد.'});
  }
  async handle(i){
    try{return await this.dispatch(i);}catch(e){
      const known=/[\u0600-\u06ff]/.test(e.message||'')?e.message:e.code===50007?'العضو لا يقبل الرسائل الخاصة.':'تعذر تنفيذ العملية. تحقق من صلاحيات البوت.';
      try{
        if(i.deferred)return await i.editReply({content:known,embeds:[],components:[]});
        if(i.replied)return await i.followUp({content:known,ephemeral:true});
        return await this.reply(i,{content:known});
      }catch{}
    }
  }
  async tick(){
    if(this.communityBusy)return;this.communityBusy=true;
    try{
    for(const [kind,items] of [['giveaway',this.store.data.giveaways],['poll',this.store.data.polls]])for(const v of Object.values(items))if(v.endsAt<=Date.now()&&!v.publishedEnd)try{await this.finishCommunity(kind,v);}catch{}
    for(const [key,s] of this.sessions)if(s.expires<Date.now())this.sessions.delete(key);
    for(const [key,t] of this.warningCooldown)if(Date.now()-t>3600000)this.warningCooldown.delete(key);
    }finally{this.communityBusy=false;}
  }
  start(){
    this.client.on('interactionCreate',i=>this.handle(i));
    this.client.on('messageCreate',m=>this.moderate(m).catch(()=>{}));
    this.timers=[setInterval(()=>this.broadcastTick().catch(()=>{}),1000),setInterval(()=>this.tick().catch(()=>{}),15000)];
    this.tick().catch(()=>{});
  }
  stop(){for(const t of this.timers||[])clearInterval(t);}
}
Object.assign(App.prototype,require('./messaging'),require('./community'));
module.exports=App;
