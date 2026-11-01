process.once('message',({input})=>{
 if(input.spin)for(;;){}
 const send=()=>process.send(input.error?{ok:false,error:{code:'ROUTING_NO_SPACE',message:'没有合法通道'}}:{ok:true,value:{id:input.id,pid:process.pid}},()=>{process.disconnect();process.exit(0)})
 setTimeout(send,input.delay??0)
})
