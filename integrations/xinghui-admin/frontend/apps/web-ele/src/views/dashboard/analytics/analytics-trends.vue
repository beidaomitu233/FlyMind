<script setup lang="ts">
import type {EchartsUIType} from '@vben/plugins/echarts';
import type {OverviewDay} from '#/api/system/flymind';
import {onMounted,ref,watch} from 'vue';
import {EchartsUI,useEcharts} from '@vben/plugins/echarts';
const props=defineProps<{rows:OverviewDay[]}>(),chartRef=ref<EchartsUIType>();const {renderEcharts}=useEcharts(chartRef);let mounted=false;
function render(){if(!mounted)return;void renderEcharts({color:['#5b5bd6','#12a594','#3e63dd'],tooltip:{trigger:'axis'},legend:{top:0,left:0},grid:{left:12,right:18,top:48,bottom:8,containLabel:true},xAxis:{type:'category',data:props.rows.map(row=>row.date.slice(5)),boundaryGap:false,axisTick:{show:false}},yAxis:{type:'value',minInterval:1,splitLine:{lineStyle:{type:'dashed',opacity:.3}}},series:[{name:'活跃用户',type:'line',symbolSize:5,data:props.rows.map(row=>Number(row.activeUsers)),areaStyle:{opacity:.08}},{name:'新增用户',type:'line',symbolSize:5,data:props.rows.map(row=>Number(row.newUsers))},{name:'登录用户',type:'line',symbolSize:5,data:props.rows.map(row=>Number(row.loginUsers))}]})}
onMounted(()=>{mounted=true;render()});watch(()=>props.rows,render);
</script>
<template><EchartsUI ref="chartRef" class="h-[300px]"/></template>
