const {SlashCommandBuilder,PermissionFlagsBits,ChannelType}=require('discord.js');
const cmd=(name,description,staff=true)=>{
  const c=new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
  if(staff)c.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
  return c;
};
const user=(c,required=true)=>c.addUserOption(o=>o.setName('user').setDescription('العضو').setRequired(required));
const channel=c=>c.addChannelOption(o=>o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText));
module.exports=[
  cmd('invoice-confirm','تأكيد حوالة CliQ أو إلغاء الفاتورة بعد مراجعة البنك').addStringOption(o=>o.setName('invoice').setDescription('رقم الفاتورة L2M-...').setRequired(true).setMaxLength(40)).addStringOption(o=>o.setName('action').setDescription('تأكيد وصول الحوالة أو إلغاء الفاتورة').setRequired(true).addChoices({name:'تأكيد وصول الحوالة',value:'confirm'},{name:'إلغاء الفاتورة',value:'cancel'})),
  cmd('invoice','إنشاء فاتورة دفع برابط خاص وتحديثات للعميل').addStringOption(o=>o.setName('amount').setDescription('المبلغ الأساسي بالدولار، مثل 10 أو 10.50').setRequired(true).setMaxLength(12)).addUserOption(o=>o.setName('user').setDescription('العميل الذي تصله تحديثات الفاتورة').setRequired(true)).addStringOption(o=>o.setName('name').setDescription('اسم الفاتورة أو المنتج').setMaxLength(120)),
  channel(user(cmd('message','إنشاء إيمبد متعدد الأقسام مع معاينة قبل النشر'),false)),
  user(cmd('dm','إرسال رسالة خاصة من البوت')),
  cmd('broadcast','إرسال برودكاست بعد اختيار الجمهور والمعاينة'),
  cmd('broadcast-status','حالة إرسال البرودكاست').addStringOption(o=>o.setName('id').setDescription('المعرف').setRequired(true)),
  cmd('broadcast-stop','إيقاف البرودكاست').addStringOption(o=>o.setName('id').setDescription('المعرف').setRequired(true)),
  cmd('notifications','استقبال رسائل البرودكاست أو إيقافها',false).addBooleanOption(o=>o.setName('enabled').setDescription('استقبال الرسائل').setRequired(true)),
  user(cmd('customer','ملف العميل',false),false).addIntegerOption(o=>o.setName('page').setDescription('الصفحة').setMinValue(1)),
  user(cmd('customer-add','إضافة منتج مسجل إلى ملف العميل')).addStringOption(o=>o.setName('product').setDescription('اسم المنتج').setRequired(true).setMaxLength(120)).addStringOption(o=>o.setName('details').setDescription('تفاصيل أو ملاحظات').setMaxLength(500)),
  user(cmd('customer-remove','حذف منتج مسجل يدويًا')).addStringOption(o=>o.setName('product-id').setDescription('معرف المنتج').setRequired(true)),
  user(cmd('role','منح رتبة للعميل')).addRoleOption(o=>o.setName('role').setDescription('الرتبة').setRequired(true)),
  cmd('feedback-setup','تحديد روم التقييمات').addChannelOption(o=>o.setName('channel').setDescription('روم التقييمات').setRequired(true).addChannelTypes(ChannelType.GuildText)).addBooleanOption(o=>o.setName('delete-new-messages').setDescription('حذف الرسائل الجديدة')),
  cmd('feedback','نموذج تقييم خاص ثم معاينة قبل النشر',false),
  cmd('giveaway','سحب مجاني على منتج').addStringOption(o=>o.setName('product').setDescription('المنتج').setRequired(true).setMaxLength(120)).addIntegerOption(o=>o.setName('hours').setDescription('المدة بالساعات').setRequired(true).setMinValue(1).setMaxValue(2160)).addIntegerOption(o=>o.setName('winners').setDescription('عدد الفائزين').setRequired(true).setMinValue(1).setMaxValue(20)).addChannelOption(o=>o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText)),
  cmd('giveaway-end','إنهاء السحب').addStringOption(o=>o.setName('id').setDescription('المعرف').setRequired(true)),
  cmd('poll','تصويت للمنتج أو الميزة القادمة').addStringOption(o=>o.setName('question').setDescription('السؤال').setRequired(true).setMaxLength(200)).addStringOption(o=>o.setName('options').setDescription('الخيارات مفصولة بعلامة |').setRequired(true).setMaxLength(900)).addIntegerOption(o=>o.setName('hours').setDescription('المدة بالساعات').setRequired(true).setMinValue(1).setMaxValue(2160)).addChannelOption(o=>o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText)),
  cmd('poll-end','إنهاء التصويت').addStringOption(o=>o.setName('id').setDescription('المعرف').setRequired(true)),
  cmd('panel','لوحة إدارة L2M Studios'),
  cmd('help','دليل أوامر البوت',false)
];
