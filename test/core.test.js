const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../src/store');
const App=require('../src/app');
const commands=require('../src/commands');
const {audienceMatches}=require('../src/messaging');
const {parseOptions,pickWinners}=require('../src/community');
const config={...require('../config.json'),guildId:'123456789012345678'};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'l2m-discord-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),client={user:{id:'bot'},users:{cache:new Map()},guilds:{cache:new Map()}};
 return {dir,store,client,app:new App(client,store,config)};
}
const i=(overrides={})=>({guildId:config.guildId,inGuild:()=>true,isButton:()=>false,user:{id:'customer',username:'Customer',displayAvatarURL:()=> 'https://cdn.discordapp.com/embed/avatars/0.png'},member:{permissions:{has:()=>false},roles:{cache:new Map()}},...overrides});
test('all 20 slash command schemas are valid',()=>{
 assert.equal(commands.length,20);const names=new Set();
 for(const c of commands){const v=c.toJSON();assert(!names.has(v.name));names.add(v.name);let optional=false;for(const opt of v.options||[]){if(!opt.required)optional=true;else assert(!optional,v.name);}}
});
test('profile persists manual products without any payment fields',t=>{
 const f=fixture(t),p=f.store.customer(config.guildId,'customer');p.products.push({id:'item',name:'L2M Markets'});f.store.save();
 const next=new Store(f.dir);assert.equal(next.customer(config.guildId,'customer').products[0].name,'L2M Markets');
 assert(!('payments' in next.data));
});
test('other people cannot read customer profiles or mutate them',async t=>{
 const f=fixture(t);let message;
 const x=i({user:{id:'other'},isChatInputCommand:()=>true,commandName:'customer',options:{getUser:()=>({id:'customer'}),getInteger:()=>1},reply:async v=>{message=v;}});
 await f.app.handle(x);assert.match(message.content,/ملفك فقط/);
 const y=i({user:{id:'other'},isChatInputCommand:()=>true,commandName:'customer-add',reply:async v=>{message=v;}});
 await f.app.handle(y);assert.match(message.content,/إدارة المتجر/);
});
test('feedback form previews privately and posts once',async t=>{
 const f=fixture(t);f.app.settings(config.guildId).feedbackChannelId='reviews';let sent=0,view;
 const x=i({reply:async v=>{view=v;},update:async v=>{view=v;},deferUpdate:async()=>{},editReply:async v=>{view=v;},isFromMessage:()=>false,
  fields:{getTextInputValue:n=>({service:'Script',rating:'٥',details:'جيد'}[n])},
  guild:{channels:{fetch:async()=>({isTextBased:()=>true,send:async v=>{sent++;return {id:'review'};}})}}});
 const sid=f.app.session(x,{kind:'feedback'});
 await f.app.feedbackComponent(x,['feedbackmodal',sid]);assert(view.ephemeral);assert.equal(sent,0);
 await f.app.feedbackComponent(x,['feedbackconfirm',sid]);assert.equal(sent,1);
 await assert.rejects(f.app.feedbackComponent(x,['feedbackconfirm',sid]));assert.equal(sent,1);
});
test('historical feedback room messages are never deleted',async t=>{
 const f=fixture(t),s=f.app.settings(config.guildId);s.feedbackChannelId='reviews';s.feedbackProtect=true;let deleted=false;
 await f.app.moderate({guild:{},guildId:config.guildId,channelId:'reviews',createdTimestamp:f.app.startedAt-10,author:{id:'other'},delete:async()=>{deleted=true;}});
 assert.equal(deleted,false);
});
test('broadcast statuses and audience selection are deterministic',async t=>{
 const f=fixture(t),member={id:'customer',user:{bot:false},presence:{status:'idle'},roles:{cache:new Map([['vip',true]])}};
 assert(audienceMatches(member,'online'));assert(!audienceMatches(member,'offline'));assert(audienceMatches(member,'role',[],'vip'));
 f.store.data.broadcasts.x={id:'x',guildId:config.guildId,createdBy:'admin',status:'RUNNING',nextAt:0,recipients:[{userId:'customer',status:'SENDING'}]};
 new App(f.client,f.store,config);assert.equal(f.store.data.broadcasts.x.recipients[0].status,'UNKNOWN');
});
test('giveaway winners are unique and poll choices validated',()=>{
 assert.equal(pickWinners(['a','a','b'],3).length,2);
 assert.deepEqual(parseOptions('One | Two'),['One','Two']);assert.throws(()=>parseOptions('One | One'));
});
test('new dashboard views can be serialized by Discord',t=>{
 const f=fixture(t);for(const view of [f.app.panelView(i()),f.app.customerView(i(),'customer'),f.app.helpView(i())]){
 for(const e of view.embeds)e.toJSON();for(const r of view.components||[])r.toJSON();
 }
});
