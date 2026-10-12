const { EmbedBuilder, StringSelectMenuBuilder, UserSelectMenuBuilder, RoleSelectMenuBuilder } = require('discord.js');
const { embed, button, row, modal, clip } = require('./ui');
const { id } = require('./store');
function validImage(value) {
  if (!value) return null;
  try { const u=new URL(value);if(u.protocol==='https:') return u.href; } catch {}
  throw new Error('روابط الصور يجب أن تبدأ بـ https://');
}
function audienceMatches(member, mode, selectedUsers=[], roleId=null) {
  if(member.user.bot) return false;
  const status=member.presence?.status || 'offline';
  if(mode==='all') return true;
  if(mode==='online') return status!=='offline';
  if(mode==='offline') return status==='offline';
  if(mode==='role') return Boolean(roleId && member.roles.cache.has(roleId));
  return selectedUsers.includes(member.id);
}
module.exports = {
  draftView(s,sid) {
    const e=new EmbedBuilder(s.embed);
    const buttons=row(button(`edit:basic:${sid}`,'النص والصور',1),button(`edit:field:${sid}`,'إضافة قسم'),button(`edit:remove:${sid}`,'حذف آخر قسم').setDisabled(!s.embed.fields?.length),button(`edit:send:${sid}`,s.kind==='broadcast'?'اختيار الجمهور':'تأكيد الإرسال',3),button(`discard:${sid}`,'إلغاء',4));
    return {content:`**معاينة خاصة** • ${s.kind==='dm'?`رسالة خاصة إلى <@${s.targetId}>`:s.kind==='broadcast'?'برودكاست':`نشر في <#${s.channelId}>${s.targetId?` مع منشن <@${s.targetId}>`:''}`}`,embeds:[e],components:[buttons],allowedMentions:{parse:[]}};
  },
  startEditor(i,kind,targetId,channelId) {
    const s={kind,targetId,channelId:channelId||i.channelId,embed:embed(this.config,'رسالة من '+this.config.brand.name,'اضغط «النص والصور» لكتابة رسالتك.').toJSON(),edited:false};
    const sid=this.session(i,s);
    return this.reply(i,this.draftView(s,sid));
  },
  audienceView(s,sid) {
    const menu=new StringSelectMenuBuilder().setCustomId(`audience:mode:${sid}`).setPlaceholder('اختيار المستلمين').addOptions(
      {label:'كل الأعضاء',value:'all'},{label:'الأونلاين (يشمل Idle و DND)',value:'online'},
      {label:'الأوفلاين (يشمل Invisible)',value:'offline'},{label:'حاملو رتبة',value:'role'},{label:'أعضاء محددون',value:'users'}
    );
    const components=[row(menu)];
    if(s.mode==='role') components.push(row(new RoleSelectMenuBuilder().setCustomId(`audience:role:${sid}`).setPlaceholder('اختر رتبة').setMaxValues(1)));
    if(s.mode==='users') components.push(row(new UserSelectMenuBuilder().setCustomId(`audience:users:${sid}`).setPlaceholder('اختر حتى 25 عضوًا').setMinValues(1).setMaxValues(25)));
    components.push(row(button(`audience:preview:${sid}`,'معاينة العدد',1).setDisabled(!s.mode),button(`edit:back:${sid}`,'الرسالة'),button(`discard:${sid}`,'إلغاء',4)));
    return {content:`الجمهور: **${s.mode||'لم يتم التحديد'}**${s.roleId?` • <@&${s.roleId}>`:''}${s.users?.length?` • ${s.users.length} أعضاء`:''}\nيُستثنى البوتات ومن أوقف إشعارات البرودكاست.`,embeds:[new EmbedBuilder(s.embed)],components,allowedMentions:{parse:[]}};
  },
  async messagingComponent(i,parts) {
    this.requireStaff(i);
    const [prefix,action,sid]=parts;
    const s=this.getSession(i,sid);
    if(prefix==='edit') {
      if(action==='basic') return i.showModal(modal(`editmodal:basic:${sid}`,'محرر الرسالة',[
        {id:'title',label:'العنوان',max:200,value:s.embed.title},
        {id:'description',label:'الوصف',long:true,max:2800,value:s.edited?s.embed.description:'',required:false},
        {id:'image',label:'رابط الصورة الكبيرة HTTPS',max:600,value:s.embed.image?.url,required:false},
        {id:'thumbnail',label:'رابط الصورة الصغيرة HTTPS',max:600,value:s.embed.thumbnail?.url,required:false},
        {id:'footer',label:'النص السفلي',max:150,value:s.embed.footer?.text,required:false}
      ]));
      if(action==='field') {
        if((s.embed.fields?.length||0)>=10) throw new Error('الحد الأقصى 10 أقسام في هذه الرسالة.');
        return i.showModal(modal(`editmodal:field:${sid}`,'إضافة قسم',[
          {id:'name',label:'عنوان القسم',max:100},{id:'value',label:'محتوى القسم',long:true,max:1000},
          {id:'inline',label:'عرض بجانب الأقسام الأخرى؟ yes / no',max:3,required:false}
        ]));
      }
      if(action==='remove') s.embed.fields?.pop();
      if(action==='send') {
        if(!s.edited) throw new Error('اكتب الرسالة قبل الإرسال.');
        if(s.kind==='broadcast') return i.update(this.audienceView(s,sid));
        await i.deferUpdate();
        return this.actionLocks.run(sid,async()=>{
          this.getSession(i,sid);
          const payload={embeds:[new EmbedBuilder(s.embed)],allowedMentions:{parse:[]}};
          if(s.kind==='dm') {const member=await this.member(i,s.targetId);await member.send(payload);}
          else {
            const ch=await i.guild.channels.fetch(s.channelId);if(!ch?.isTextBased()) throw new Error('الروم غير متاح.');
            if(!ch.permissionsFor(i.member)?.has('ViewChannel')) throw new Error('لا تملك صلاحية عرض الروم.');
            if(s.targetId) {await this.member(i,s.targetId);payload.content=`<@${s.targetId}>`;payload.allowedMentions={users:[s.targetId]};}
            await ch.send(payload);
          }
          this.sessions.delete(sid);this.store.audit(i.guildId,i.user.id,s.kind+'.send',s.targetId||s.channelId);
          return i.editReply({content:'تم إرسال الرسالة.',embeds:[],components:[]});
        });
      }
      return i.update(this.draftView(s,sid));
    }
    if(prefix==='editmodal') {
      const next=structuredClone(s.embed);
      if(action==='basic') {
        next.title=i.fields.getTextInputValue('title').trim();
        next.description=i.fields.getTextInputValue('description').trim()||undefined;
        const image=validImage(i.fields.getTextInputValue('image').trim()),thumb=validImage(i.fields.getTextInputValue('thumbnail').trim());
        next.image=image?{url:image}:undefined;next.thumbnail=thumb?{url:thumb}:undefined;
        const footer=i.fields.getTextInputValue('footer').trim();next.footer=footer?{text:footer}:undefined;
      } else (next.fields ||= []).push({name:i.fields.getTextInputValue('name'),value:i.fields.getTextInputValue('value'),inline:/^(yes|نعم)$/i.test(i.fields.getTextInputValue('inline'))});
      const size=(next.title?.length||0)+(next.description?.length||0)+(next.footer?.text?.length||0)+(next.fields||[]).reduce((n,f)=>n+f.name.length+f.value.length,0);
      if(size>5800) throw new Error('الإيمبد طويل جدًا. اختصر المحتوى ليكون أقل من 5800 حرف.');
      s.embed=next;s.edited=true;
      return i.update(this.draftView(s,sid));
    }
    if(prefix==='audience') {
      if(action==='mode') {s.mode=i.values[0];s.roleId=null;s.users=[];s.recipients=null;return i.update(this.audienceView(s,sid));}
      if(action==='role') {s.roleId=i.values[0];s.recipients=null;return i.update(this.audienceView(s,sid));}
      if(action==='users') {s.users=i.values;s.recipients=null;return i.update(this.audienceView(s,sid));}
      if(action==='preview') {
        if(s.mode==='role'&&!s.roleId || s.mode==='users'&&!s.users?.length) throw new Error('حدد الرتبة أو الأعضاء أولًا.');
        await i.deferUpdate();
        const members=await i.guild.members.fetch({withPresences:['online','offline'].includes(s.mode),time:60000});
        s.recipients=[...members.values()].filter(m=>audienceMatches(m,s.mode,s.users,s.roleId)&&!this.store.data.optouts[`${i.guildId}:${m.id}`]).map(m=>m.id);
        if(!s.recipients.length) throw new Error('لا يوجد أعضاء مطابقون للاختيار.');
        if(s.recipients.length>this.config.broadcastMaxRecipients) throw new Error('عدد المستلمين أكبر من broadcastMaxRecipients في الكونفق.');
        s.previewAt=Date.now();
        return i.editReply({content:`**تأكيد البرودكاست**\nعدد المستلمين: **${s.recipients.length}**\nالجمهور: **${s.mode}** • المدة التقريبية: ${Math.ceil(s.recipients.length*Math.max(3000,this.config.broadcastDelayMs)/60000)} دقيقة\nالأعضاء المخفيون يظهرون أوفلاين. إغلاق الخاص قد يمنع بعض الرسائل.`,embeds:[new EmbedBuilder(s.embed)],components:[row(button(`audience:confirm:${sid}`,'بدء الإرسال',3),button(`edit:send:${sid}`,'تغيير الجمهور'),button(`discard:${sid}`,'إلغاء',4))]});
      }
      if(action==='confirm') {
        if(!s.recipients?.length || Date.now()-s.previewAt>300000) throw new Error('حدّث معاينة الجمهور قبل الإرسال.');
        const jobId=id();
        this.store.data.broadcasts[jobId]={id:jobId,guildId:i.guildId,createdBy:i.user.id,createdAt:Date.now(),status:'RUNNING',embed:s.embed,
          recipients:s.recipients.map(userId=>({userId,status:'QUEUED'})),nextAt:0};
        this.sessions.delete(sid);this.store.audit(i.guildId,i.user.id,'broadcast.start',jobId);
        return i.update({content:`بدأ البرودكاست.\nالمعرف: \`${jobId}\`\nتابعه باستخدام /broadcast-status وأوقفه باستخدام /broadcast-stop.`,embeds:[],components:[]});
      }
    }
  },
  broadcastView(job) {
    const counts={};for(const r of job.recipients) counts[r.status]=(counts[r.status]||0)+1;
    return {embeds:[embed(this.config,'متابعة البرودكاست',`ID: \`${job.id}\`\nالحالة: **${job.status}**`).addFields(
      {name:'تم الإرسال',value:String(counts.SENT||0),inline:true},{name:'فشل',value:String(counts.FAILED||0),inline:true},
      {name:'بانتظار الإرسال',value:String(counts.QUEUED||0),inline:true},{name:'مستثنى',value:String(counts.SKIPPED||0),inline:true},
      {name:'حالة غير مؤكدة بعد انقطاع',value:String(counts.UNKNOWN||0),inline:true}
    )]};
  },
  async broadcastTick() {
    if(this.broadcastBusy) return;this.broadcastBusy=true;
    try {
      const job=Object.values(this.store.data.broadcasts).find(j=>j.status==='RUNNING'&&j.nextAt<=Date.now());
      if(!job) return;
      const r=job.recipients.find(r=>r.status==='QUEUED');
      if(!r) {job.status='COMPLETED';this.store.save();return;}
      if(this.store.data.optouts[`${job.guildId}:${r.userId}`]) {r.status='SKIPPED';this.store.save();return;}
      r.status='SENDING';this.store.save();
      try {
        const guild=await this.client.guilds.fetch(job.guildId);
        const actor=await guild.members.fetch(job.createdBy);
        if(!this.isStaffMember(actor)) {r.status='QUEUED';job.status='STOPPED';this.store.save();return;}
        const member=await guild.members.fetch(r.userId);
        await member.send({embeds:[new EmbedBuilder(job.embed)],components:[row(button(`optout:${job.guildId}`,'إيقاف رسائل البرودكاست'))],allowedMentions:{parse:[]}});
        r.status='SENT';
      } catch(e) {
        if(e.status===429||e.code===429) {r.status='QUEUED';job.nextAt=Date.now()+Math.max(60000,(e.retry_after||60)*1000);}
        else {r.status='FAILED';r.error=Number(e.code)||'SEND_FAILED';}
      }
      job.nextAt=Math.max(job.nextAt,Date.now()+Math.max(3000,this.config.broadcastDelayMs));
      if(!job.recipients.some(r=>r.status==='QUEUED')) job.status='COMPLETED';
      this.store.save();
    } finally {this.broadcastBusy=false;}
  }
};
module.exports.audienceMatches=audienceMatches;
