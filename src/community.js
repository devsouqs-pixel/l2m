const { randomInt } = require('node:crypto');
const { StringSelectMenuBuilder } = require('discord.js');
const { id } = require('./store');
const { embed, button, row, modal, clip } = require('./ui');
function pickWinners(entries,count) {
  const pool=[...new Set(entries)],selected=[];
  while(pool.length&&selected.length<count) selected.push(pool.splice(randomInt(pool.length),1)[0]);
  return selected;
}
function parseOptions(text) {
  const values=text.split('|').map(v=>v.trim()).filter(Boolean);
  if(values.length<2||values.length>10||values.some(v=>v.length>80)||new Set(values).size!==values.length) throw new Error('اكتب من خيارين إلى 10 خيارات مختلفة، كل خيار حتى 80 حرفًا، وافصل بينها بـ |');
  return values;
}
module.exports = {
  settings(guildId) {
    return this.store.data.settings[guildId] ||= {feedbackChannelId:this.config.feedbackChannelId,feedbackProtect:Boolean(this.config.feedbackChannelId),feedbackSince:this.startedAt};
  },
  feedbackModal(sid) {return modal(`feedbackmodal:${sid}`,'تقييم تجربتك مع المتجر',[
    {id:'service',label:'اسم الخدمة أو المنتج',max:100},
    {id:'rating',label:'التقييم من 1 إلى 5',max:1,placeholder:'5'},
    {id:'details',label:'تفاصيل تجربتك',long:true,max:1500}
  ]);},
  openFeedback(i) {
    if(!this.settings(i.guildId).feedbackChannelId) throw new Error('لم يتم تحديد روم التقييمات بعد.');
    const last=Object.values(this.store.data.feedback).filter(v=>v.guildId===i.guildId&&v.userId===i.user.id).sort((a,b)=>b.createdAt-a.createdAt)[0];
    if(last&&Date.now()-last.createdAt<this.config.feedbackCooldownMinutes*60000) throw new Error(`يمكنك إرسال تقييم جديد كل ${this.config.feedbackCooldownMinutes} دقيقة.`);
    const sid=this.session(i,{kind:'feedback'});return i.showModal(this.feedbackModal(sid));
  },
  feedbackEmbed(i,s) {return embed(this.config,'تقييم عميل • Customer Review',s.details).setAuthor({name:i.user.globalName||i.user.username,iconURL:i.user.displayAvatarURL()}).addFields(
    {name:'الخدمة',value:s.service,inline:true},{name:'التقييم',value:'★'.repeat(s.rating)+'☆'.repeat(5-s.rating)+`  ${s.rating}/5`,inline:true},{name:'العميل',value:`<@${i.user.id}>`,inline:true}
  );},
  async feedbackComponent(i,parts) {
    const [prefix,sid]=parts,s=this.getSession(i,sid);
    if(s.kind!=='feedback') throw new Error('النموذج غير صالح.');
    if(prefix==='feedbackmodal') {
      s.service=i.fields.getTextInputValue('service').trim();s.details=i.fields.getTextInputValue('details').trim();
      const raw=i.fields.getTextInputValue('rating').replace(/[٠-٩]/g,v=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(v)));
      s.rating=Number(raw);
      if(!s.service||!s.details||!Number.isInteger(s.rating)||s.rating<1||s.rating>5) throw new Error('اكتب الخدمة والتفاصيل واختر تقييمًا صحيحًا من 1 إلى 5.');
      const payload={embeds:[this.feedbackEmbed(i,s)],components:[row(button(`feedbackconfirm:${sid}`,'تأكيد ونشر التقييم',3),button(`feedbackedit:${sid}`,'تعديل'),button(`discard:${sid}`,'إلغاء',4))]};
      if(i.isFromMessage()) return i.update(payload);
      return this.reply(i,payload);
    }
    if(prefix==='feedbackedit') return i.showModal(modal(`feedbackmodal:${sid}`,'تعديل التقييم',[
      {id:'service',label:'اسم الخدمة',max:100,value:s.service},{id:'rating',label:'التقييم من 1 إلى 5',max:1,value:s.rating},{id:'details',label:'التفاصيل',max:1500,long:true,value:s.details}
    ]));
    if(prefix==='feedbackconfirm') {
      await i.deferUpdate();
      return this.actionLocks.run(`feedback:${i.guildId}:${i.user.id}`,async()=>{
        this.getSession(i,sid);
        const recent=Object.values(this.store.data.feedback).some(v=>v.guildId===i.guildId&&v.userId===i.user.id&&Date.now()-v.createdAt<this.config.feedbackCooldownMinutes*60000);
        if(recent) throw new Error('تم إرسال تقييم مؤخرًا.');
        const ch=await i.guild.channels.fetch(this.settings(i.guildId).feedbackChannelId);
        if(!ch?.isTextBased()) throw new Error('روم التقييمات غير متاح.');
        const message=await ch.send({embeds:[this.feedbackEmbed(i,s)],allowedMentions:{parse:[]}});
        this.store.data.feedback[sid]={guildId:i.guildId,userId:i.user.id,service:s.service,rating:s.rating,details:s.details,createdAt:Date.now(),messageId:message.id};
        this.store.save();this.sessions.delete(sid);
        return i.editReply({content:'شكرًا لك، تم نشر تقييمك.',embeds:[],components:[]});
      });
    }
  },
  async moderate(message) {
    if(!message.guild || message.author.id===this.client.user.id || message.createdTimestamp<this.startedAt) return;
    if(this.config.guildId && message.guildId!==this.config.guildId) return;
    const settings=this.settings(message.guildId);
    if(!settings.feedbackProtect||message.channelId!==settings.feedbackChannelId||message.createdTimestamp<settings.feedbackSince) return;
    const timer=setTimeout(()=>message.delete().catch(()=>{}),Math.max(0,this.config.feedbackDeleteDelaySeconds)*1000);timer.unref();
    if(message.author.bot) return;
    const key=`${message.guildId}:${message.author.id}`;
    if(Date.now()-(this.warningCooldown.get(key)||0)<60000) return;
    this.warningCooldown.set(key,Date.now());
    try {await message.author.send({embeds:[embed(this.config,'روم التقييمات',`استخدم الأمر **/feedback** داخل سيرفر **${message.guild.name}** لفتح نموذج التقييم الخاص بك.\nتُحذف الرسائل العادية الجديدة فقط من روم التقييمات.`)],allowedMentions:{parse:[]}});}
    catch {}
  },
  giveawayView(g) {
    const ended=g.status==='ENDED';
    const e=embed(this.config,`سحب مجاني • ${g.product}`,ended?(g.winners.length?`الفائزون: ${g.winners.map(id=>`<@${id}>`).join(' • ')}`:'انتهى السحب دون مشاركين مؤهلين.'):`اضغط للمشاركة مجانًا.\nينتهي <t:${Math.floor(g.endsAt/1000)}:R>`).addFields(
      {name:'عدد الفائزين',value:String(g.count),inline:true},{name:'المشاركون',value:String(g.entries.length),inline:true},{name:'المعرف',value:`\`${g.id}\``,inline:true}
    );
    return {embeds:[e],components:ended?[]:[row(button(`giveaway:join:${g.id}`,'مشاركة / انسحاب',1))],allowedMentions:{parse:[]}};
  },
  pollView(p) {
    const counts=p.options.map((_,idx)=>Object.values(p.votes).filter(v=>v===idx).length);
    const total=Object.keys(p.votes).length;
    const desc=p.options.map((v,idx)=>`**${idx+1}. ${v}**\n${'▰'.repeat(Math.round((counts[idx]/Math.max(total,1))*10))}${'▱'.repeat(10-Math.round((counts[idx]/Math.max(total,1))*10))}  ${counts[idx]} (${Math.round(counts[idx]/Math.max(total,1)*100)}%)`).join('\n\n');
    const menu=new StringSelectMenuBuilder().setCustomId(`poll:vote:${p.id}`).setPlaceholder('اختر رأيك أو غيّر تصويتك').addOptions(p.options.map((v,idx)=>({label:v,value:String(idx)})));
    return {embeds:[embed(this.config,p.question,desc).addFields({name:'الحالة',value:p.status==='ENDED'?'انتهى التصويت':`ينتهي <t:${Math.floor(p.endsAt/1000)}:R>`,inline:true},{name:'الأصوات',value:String(total),inline:true},{name:'المعرف',value:`\`${p.id}\``,inline:true})],components:p.status==='ENDED'?[]:[row(menu)],allowedMentions:{parse:[]}};
  },
  async finishCommunity(kind,v) {
    return this.actionLocks.run(`${kind}:${v.id}`,async()=>{
      if(v.status==='RUNNING') {
        if(kind==='giveaway') {
          const guild=await this.client.guilds.fetch(v.guildId);
          const members=await guild.members.fetch({time:60000});
          v.winners=pickWinners(v.entries.filter(id=>members.has(id)&&!members.get(id).user.bot),v.count);
        }
        v.status='ENDED';v.endedAt=Date.now();this.store.save();
      }
      if(!v.publishedEnd) {
        const ch=await this.client.channels.fetch(v.channelId);
        await ch.messages.edit(v.messageId,kind==='giveaway'?this.giveawayView(v):this.pollView(v));
        v.publishedEnd=true;this.store.save();
      }
    });
  },
  async communityCommand(i, form=null) {
    const o=form?.options || i.options,n=form?.commandName || i.commandName;
    if(n==='feedback') return this.openFeedback(i);
    this.requireStaff(i);
    if(n==='feedback-setup') {
      if(!i.memberPermissions.has('Administrator')) throw new Error('إعداد الحذف التلقائي يحتاج Administrator.');
      const ch=o.getChannel('channel'),protect=o.getBoolean('delete-new-messages')!==false;
      const s=this.settings(i.guildId);
      s.feedbackChannelId=ch.id;s.feedbackProtect=protect;s.feedbackSince=Date.now();
      this.store.audit(i.guildId,i.user.id,'feedback.setup',ch.id);
      return this.reply(i,{content:`تم تعيين <#${ch.id}> للتقييمات. حماية الرسائل الجديدة: **${protect?'مفعلة':'متوقفة'}**.\nالرسائل السابقة لن تُقرأ أو تُحذف.`});
    }
    if(n==='giveaway-end'||n==='poll-end') {
      const kind=n.split('-')[0],v=this.store.data[kind==='poll'?'polls':'giveaways'][o.getString('id')];
      if(!v||v.guildId!==i.guildId) throw new Error('المعرف غير موجود في هذا السيرفر.');
      await i.deferReply({ephemeral:true});await this.finishCommunity(kind,v);return i.editReply('تم إنهاء العملية وتحديث الرسالة.');
    }
    await i.deferReply({ephemeral:true});
    const channel=o.getChannel('channel')||i.channel;
    if(!channel.permissionsFor(i.member)?.has('ViewChannel')) throw new Error('لا تملك صلاحية عرض الروم.');
    const v={id:id(),guildId:i.guildId,channelId:channel.id,createdBy:i.user.id,endsAt:Date.now()+o.getInteger('hours')*3600000,status:'RUNNING'};
    if(n==='giveaway') {Object.assign(v,{product:o.getString('product'),count:o.getInteger('winners'),entries:[],winners:[]});}
    else Object.assign(v,{question:o.getString('question'),options:parseOptions(o.getString('options')),votes:{}});
    const msg=await channel.send(n==='giveaway'?this.giveawayView(v):this.pollView(v));v.messageId=msg.id;
    this.store.data[n==='giveaway'?'giveaways':'polls'][v.id]=v;this.store.audit(i.guildId,i.user.id,n+'.create',v.id);
    return i.editReply(`تم النشر في <#${channel.id}>. المعرف: \`${v.id}\``);
  },
  async communityComponent(i,parts) {
    const [kind,,key]=parts;
    const v=this.store.data[kind==='giveaway'?'giveaways':'polls'][key];
    if(!v||v.guildId!==i.guildId||v.status!=='RUNNING'||v.endsAt<=Date.now()) throw new Error('انتهى السحب أو التصويت.');
    await i.deferReply({ephemeral:true});
    return this.actionLocks.run(`${kind}:${key}`,async()=>{
      if(v.status!=='RUNNING'||v.endsAt<=Date.now()) throw new Error('انتهت المهلة.');
      await this.member(i,i.user.id);
      let content;
      if(kind==='giveaway') {
        if(v.entries.includes(i.user.id)) {v.entries=v.entries.filter(id=>id!==i.user.id);content='تم إلغاء مشاركتك.';}
        else {v.entries.push(i.user.id);content='تم تسجيل مشاركتك بالسحب.';}
      } else {const choice=Number(i.values[0]);if(!Number.isInteger(choice)||!v.options[choice]) throw new Error('خيار غير صالح.');v.votes[i.user.id]=choice;content='تم حفظ تصويتك.';}
      this.store.save();
      try {await i.message.edit(kind==='giveaway'?this.giveawayView(v):this.pollView(v));} catch {}
      return i.editReply(content);
    });
  }
};
module.exports.pickWinners=pickWinners;
module.exports.parseOptions=parseOptions;
