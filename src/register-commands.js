const {Routes}=require('discord.js');
const commands=require('./commands');
async function registerCommands(rest,clientId,guildId){
  await rest.put(Routes.applicationGuildCommands(clientId,guildId),{body:commands.map(command=>command.toJSON())});
  const global=await rest.get(Routes.applicationCommands(clientId));
  const names=new Set(commands.map(command=>command.name));
  for(const command of global)if((command.type||1)===1&&names.has(command.name))await rest.delete(Routes.applicationCommand(clientId,command.id));
}
module.exports={registerCommands};
