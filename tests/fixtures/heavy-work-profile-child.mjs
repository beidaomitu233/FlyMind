process.once('message',({input})=>{
 if(input.spin)for(;;){}
 process.send({ok:true,value:{args:process.execArgv}},()=>{process.disconnect();process.exit(0)})
})
