const fs=require('node:fs');
const path=require('node:path');
const {Client,GatewayIntentBits,Partials,REST,Routes}=require('discord.js');
const config=require('./src/config');
const commands=require('./src/commands');
const {Store}=require('./src/store');
const App=require('./src/app');
const {Invoices}=require('./src/invoices');
const {createCheckoutServer}=require('./src/checkout-server');
let startupStage='configuration';
async function main(){
  const missing=[['DISCORD_TOKEN',config.token],['DISCORD_CLIENT_ID',config.clientId],['DISCORD_GUILD_ID',config.guildId]].filter(([,value])=>!value).map(([name])=>name);
  if(!config.webOnly&&missing.length)throw new Error(`Missing variables: ${missing.join(', ')}`);
  if(!config.webOnly&&(!/^\d{15,22}$/.test(config.clientId)||!/^\d{15,22}$/.test(config.guildId)))throw new Error('DISCORD_CLIENT_ID and DISCORD_GUILD_ID must be numeric Discord IDs');
  startupStage='storage';
  fs.mkdirSync(config.dataDir,{recursive:true});
  const lock=path.join(config.dataDir,'bot.lock');
  if(fs.existsSync(lock)){
    const pid=Number(fs.readFileSync(lock,'utf8'));
    let active=false;
    if(Number.isInteger(pid)&&pid>0&&pid!==process.pid)try{process.kill(pid,0);active=true;}catch(e){if(e.code==='EPERM')active=true;}
    if(active)throw new Error('Another process is running');
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock,String(process.pid),{flag:'wx',mode:0o600});
  process.on('exit',()=>{try{if(fs.readFileSync(lock,'utf8')===String(process.pid))fs.unlinkSync(lock);}catch{}});
  const store=new Store(config.dataDir);
  const invoices=new Invoices(store,config);
  const server=createCheckoutServer(invoices,config);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.checkout.port,'0.0.0.0',resolve);});
  process.stdout.write(`Checkout listening on port ${config.checkout.port}\n`);
  const notificationTimer=setInterval(()=>invoices.notifications(),10000);
  if(config.webOnly){const close=()=>{clearInterval(notificationTimer);server.close(()=>process.exit(0));};process.once('SIGINT',close);process.once('SIGTERM',close);return;}
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildPresences,GatewayIntentBits.GuildMessages,GatewayIntentBits.DirectMessages],partials:[Partials.Channel],allowedMentions:{parse:[]}});
  const app=new App(client,store,config);
  app.invoices=invoices;
  client.once('ready',()=>app.start());
  startupStage='command-registration';
  await new REST({version:'10'}).setToken(config.token).put(Routes.applicationGuildCommands(config.clientId,config.guildId),{body:commands.map(c=>c.toJSON())});
  startupStage='discord-login';
  await client.login(config.token);
  const shutdown=()=>{clearInterval(notificationTimer);server.close();app.stop();client.destroy();store.save();process.exit(0);};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
main().catch(error=>{
  const code=String(error?.code||error?.status||'UNKNOWN').slice(0,40);
  let safeMessage=String(error?.message||error?.name||'Unknown startup error');
  if(config.token)safeMessage=safeMessage.replaceAll(config.token,'[REDACTED]');
  safeMessage=safeMessage.replace(/(bot|bearer)\s+[a-z0-9_.-]+/gi,'$1 [REDACTED]').replace(/https?:\/\/\S+/gi,'[URL]').replace(/[\r\n\t]+/g,' ').slice(0,500);
  if(/disallowed intents|privileged intent/i.test(safeMessage))safeMessage+=' — Enable Server Members Intent and Presence Intent in Discord Developer Portal > Bot';
  process.stderr.write(`Startup error at ${startupStage} (code ${code}): ${safeMessage}\n`);
  process.exitCode=1;
  process.exit(1);
});
