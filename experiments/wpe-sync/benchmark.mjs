// Run inside a disposable Node container sharing only the WPE network namespace.
// No login secrets, anti-bot bypass, third-party writes, or production control plane.
const base='http://127.0.0.1:9515';
async function wd(method,path,body){
 const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(32000)});
 const data=await r.json();if(data.value?.error)throw Error(data.value.error+': '+data.value.message);return data.value;
}
const caps={capabilities:{alwaysMatch:{'wpe:browserOptions':{binary:'/usr/lib/x86_64-linux-gnu/wpe-webkit-2.0/MiniBrowser',args:['--headless','--automation']}}}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const results={at:new Date().toISOString(),engine:'WPE MiniBrowser 2.48.3',method:'5 sequential fresh browser sessions; prestarted driver, warm image/filesystem; HTTP from adjacent container; no SSH in timed requests',samples:[],sites:[]};
for(let i=0;i<5;i++){
 let sid;const sample={run:i+1};try{
  let start=performance.now();const s=await wd('POST','/session',caps);sid=s.sessionId;sample.createMs=Math.round(performance.now()-start);
  await wd('POST','/session/'+sid+'/timeouts',{pageLoad:25000,script:12000,implicit:0});
  start=performance.now();await wd('POST','/session/'+sid+'/url',{url:'https://masaka-ai.vercel.app/browser-check.html'});sample.navigateMs=Math.round(performance.now()-start);
  start=performance.now();const title=await wd('GET','/session/'+sid+'/title');sample.titleMs=Math.round(performance.now()-start);if(title!=='MASAKA browser verification')throw Error('Unexpected fixture title');
  start=performance.now();await wd('POST','/session/'+sid+'/execute/sync',{script:'localStorage.setItem("bench","ok");return localStorage.getItem("bench");',args:[]});sample.storageMs=Math.round(performance.now()-start);
  start=performance.now();try{const png=await wd('GET','/session/'+sid+'/screenshot');sample.screenshotMs=Math.round(performance.now()-start);sample.screenshotBytes=Buffer.from(png,'base64').length;}catch(e){sample.screenshotError=e.message;}
 }catch(e){sample.error=e.message;}finally{if(sid)await wd('DELETE','/session/'+sid).catch(()=>{});}
 results.samples.push(sample);console.log(JSON.stringify({type:'sample',...sample}));
}
const sites=[
 {site:'xhs',url:'https://www.xiaohongshu.com/search_result?keyword='+encodeURIComponent('旅行')},
 {site:'tiktok',url:'https://www.tiktok.com/search?q=travel'},
 {site:'trip.com',url:'https://www.trip.com/hotels/list?city=2'},
 {site:'arxiv',url:'https://arxiv.org/search/?query=browser+agent&searchtype=all&abstracts=show&order=-announced_date_first'}
];
for(const site of sites){let sid;const row={...site,authenticated:false};try{
 const s=await wd('POST','/session',caps);sid=s.sessionId;
 await wd('POST','/session/'+sid+'/timeouts',{pageLoad:25000,script:12000,implicit:0});
 const start=performance.now();try{await wd('POST','/session/'+sid+'/url',{url:site.url});row.navigateMs=Math.round(performance.now()-start);}catch(e){row.navigationError=e.message;}
 await sleep(3500);
 row.page=await wd('POST','/session/'+sid+'/execute/sync',{script:`return {title:document.title,url:location.origin+location.pathname,text:document.body?document.body.innerText.slice(0,1400):'',links:Array.from(document.querySelectorAll('a[href]')).filter(a=>a.innerText.trim()).slice(0,10).map(a=>({text:a.innerText.trim().slice(0,80),href:new URL(a.href).origin+new URL(a.href).pathname})),arxivResults:document.querySelectorAll('.arxiv-result').length,inputs:Array.from(document.querySelectorAll('input')).slice(0,8).map(e=>({type:e.type,placeholder:e.placeholder}))};`,args:[]});
 }catch(e){row.error=e.message;}finally{if(sid)await wd('DELETE','/session/'+sid).catch(()=>{});}
 results.sites.push(row);console.log(JSON.stringify({type:'site',...row}));
}
console.log(JSON.stringify({type:'complete',...results}));
