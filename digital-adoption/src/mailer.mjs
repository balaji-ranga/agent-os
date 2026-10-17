import nodemailer from 'nodemailer';
export function createMailer(config){
 let transport;
 return async message=>{
  if(!config?.host||!config.from)throw new Error('Registration email is not configured');
  transport||=nodemailer.createTransport({host:config.host,port:config.port||587,secure:config.secure===true,requireTLS:config.secure!==true,auth:config.user?{user:config.user,pass:config.pass}:undefined,connectionTimeout:10000,socketTimeout:15000,logger:false,debug:false});
  const result=await transport.sendMail({from:config.from,to:message.to,subject:message.subject,text:message.text,disableFileAccess:true,disableUrlAccess:true});
  if(!result.accepted?.length||result.rejected?.length)throw new Error('Email delivery rejected');
 };
}
