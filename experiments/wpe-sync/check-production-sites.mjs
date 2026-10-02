import {createClient} from '@supabase/supabase-js';

const api=process.env.API_ORIGIN||'https://masaka-backend.vercel.app',sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sites=[
 {site:'duckduckgo',url:'https://duckduckgo.com/?q=browser+agent'},
 {site:'amazon',url:'https://www.amazon.com/s?k=wireless+mouse'},
 {site:'trip.com',url:'https://www.trip.com/hotels/list?city=2'},
 {site:'arxiv',url:'https://arxiv.org/search/?query=browser+agent&searchtype=all&abstracts=show&order=-announced_date_first'},
 {site:'xhs',url:'https://www.xiaohongshu.com/search_result?keyword='+encodeURIComponent('旅行')},
 {site:'tiktok',url:'https://www.tiktok.com/search?q=travel'},
];
const config=await (await fetch(`${api}/api/config`)).json(),auth=createClient(config.supabaseUrl,config.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}}),login=await auth.auth.signInWithPassword({email:process.env.TEST_ACCOUNT_EMAIL,password:process.env.TEST_ACCOUNT_PASSWORD});if(login.error)throw login.error;const token=login.data.session.access_token;
async function request(path,method='GET',body){const response=await fetch(`${api}/api/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)}),data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
async function waitSession(id,predicate,limit=120){for(let index=0;index<limit;index++){const value=await request(`sessions/${id}`);if(predicate(value))return value;if(value.status==='failed')throw Error(value.error||'Session failed');await sleep(500);}throw Error('Session wait timed out');}
async function command(id,payload){const queued=await request(`sessions/${id}/commands`,'POST',payload);for(let index=0;index<120;index++){const value=await request(`commands/${queued.id}`);if(value.status==='completed')return value.result;if(value.status==='failed')throw Error(value.error);await sleep(250);}throw Error('Command timed out');}
async function stop(id){await request(`sessions/${id}/stop`,'POST',{}).catch(()=>{});await waitSession(id,value=>['completed','failed'].includes(value.status)).catch(()=>{});}
const results=[];
try{
	 for(const target of sites){let session;const row={site:target.site,url:target.url};try{const started=performance.now(),created=await request('sessions','POST',{name:`Public site check · ${target.site}`,url:target.url,max_seconds:75});session=await waitSession(created.id,value=>value.status==='running');row.startupMs=Math.round(performance.now()-started);await sleep(2500);const result=await command(session.id,{kind:'evaluate',expression:`(()=>{const text=(document.body?.innerText||'').slice(0,12000),title=document.title,lower=(title+' '+text).toLowerCase(),marker=/captcha|verify you are|robot check|access denied|unusual traffic|安全验证|验证码/.test(lower),challenge=marker&&(text.length<1800||/captcha|access denied|robot|verify/.test(title.toLowerCase()));return {title,url:location.href,textLength:text.length,linkCount:document.querySelectorAll('a[href]').length,inputCount:document.querySelectorAll('input').length,challenge,excerpt:text.slice(0,180)}})()`});const value=result.evaluation?.result?.value;if(result.evaluation?.exceptionDetails)throw Error(result.evaluation.exceptionDetails.text);Object.assign(row,value,{worker:session.worker_id,status:value?.challenge?'challenge':'rendered'});}catch(error){row.status='failed';row.error=error.message;}finally{if(session)await stop(session.id);}results.push(row);console.log(JSON.stringify({type:'site',...row}));}
 console.log(JSON.stringify({type:'complete',at:new Date().toISOString(),engine:'WPE WebKit',worker:'deeptensor-wpe-01',results}));
}finally{await auth.auth.signOut({scope:'local'});auth.realtime.disconnect();}
