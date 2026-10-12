const {EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle}=require('discord.js');
const clip=(value,max=1000)=>String(value||'—').slice(0,max);
function embed(config,title,body){
  const e=new EmbedBuilder().setColor(config.brand.color).setTitle(clip(title,256)).setFooter({text:`${config.brand.name} • ${config.brand.slogan}`}).setTimestamp();
  if(body)e.setDescription(clip(body,4000));
  if(/^https:\/\//.test(config.brand.logoUrl))e.setThumbnail(config.brand.logoUrl);
  return e;
}
const button=(id,label,style=ButtonStyle.Secondary)=>new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row=(...items)=>new ActionRowBuilder().addComponents(items);
function modal(id,title,inputs){
  return new ModalBuilder().setCustomId(id).setTitle(clip(title,45)).addComponents(inputs.map(v=>{
    const input=new TextInputBuilder().setCustomId(v.id).setLabel(v.label).setStyle(v.long?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(v.required!==false).setMaxLength(v.max||100);
    if(v.value)input.setValue(String(v.value));
    if(v.placeholder)input.setPlaceholder(v.placeholder);
    return row(input);
  }));
}
module.exports={embed,button,row,modal,clip};
