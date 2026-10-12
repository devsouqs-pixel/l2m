const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const id=()=>randomBytes(9).toString('hex');
class Store {
  constructor(dir) {
    fs.mkdirSync(dir,{recursive:true});
    this.file=path.join(dir,'store.json');
    this.data=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{version:1,customers:{},settings:{},feedback:{},giveaways:{},polls:{},broadcasts:{},optouts:{},audit:[]};
    if(this.data.version!==1||!this.data.customers||!this.data.broadcasts) throw new Error('Database corrupt');
    if(!fs.existsSync(this.file)) this.save();
  }
  save() {
    const file=this.file+'.tmp';
    const fd=fs.openSync(file,'w',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(this.data,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(fs.existsSync(this.file)) fs.copyFileSync(this.file,this.file+'.bak');
    fs.renameSync(file,this.file);
  }
  customer(guildId,userId) {
    return this.data.customers[`${guildId}:${userId}`] ||= {guildId,userId,createdAt:new Date().toISOString(),products:[],notes:''};
  }
  audit(guildId,actor,action,detail) {
    this.data.audit.push({at:new Date().toISOString(),guildId,actor,action,detail});
    this.data.audit=this.data.audit.slice(-10000);this.save();
  }
}
class Locks {
  constructor(){this.tails=new Map();}
  async run(key,fn) {
    const prev=this.tails.get(key)||Promise.resolve();let release;
    const next=new Promise(r=>{release=r;});this.tails.set(key,next);
    await prev;try{return await fn();}finally{release();if(this.tails.get(key)===next)this.tails.delete(key);}
  }
}
module.exports={Store,Locks,id};
