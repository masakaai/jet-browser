// Native download journal contract. Not yet wired into the production worker.
// Input must come from the worker-assigned native process, never page JS.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fail=()=>{throw Error('Invalid native download journal');};
const uint=value=>{
  if(!/^(0|[1-9][0-9]*)$/.test(value))fail();
  const number=Number(value);if(!Number.isSafeInteger(number))fail();return number;
};
function decodeName(value){
  if(value.length>1368||!value.length)fail();
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value||bytes.length>1024)fail();
  let name;try{name=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail();}
  if(!name||name==='.'||name==='..'||/[\x00-\x1f\x7f/\\]/.test(name))fail();
  return name;
}
export function parseDownloadJournal(text,{maxBytes=4*1024*1024,maxDownloads=100}={}){
  if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024)fail();
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>4*1024*1024||!Number.isSafeInteger(maxDownloads)||maxDownloads<1||maxDownloads>100)fail();
  // The native writer may currently be appending the last line. Never consume
  // its uncommitted suffix; callers must retain and re-read it on the next poll.
  const lines=text.slice(0,text.lastIndexOf('\n')+1).split('\n');lines.pop();
  const records=new Map();let ready=false;
  for(const line of lines){
    if(!ready){if(line!=='ready')fail();ready=true;continue;}
    const [event,id,...fields]=line.split('\t');
    if(!uuid.test(id||''))fail();
    if(event==='started'){
      if(fields.length!==2||fields[0]!=='0'||fields[1]!=='0'||records.has(id)||records.size>=maxDownloads)fail();
      records.set(id,{id,bytes:0,name:null,destination:false,failed:false,finished:false});continue;
    }
    const record=records.get(id);if(!record||record.finished)fail();
    if(event==='name'){
      if(fields.length!==1||record.name!==null||record.destination||record.failed)fail();
      record.name=decodeName(fields[0]);continue;
    }
    if(!['destination','failed','finished'].includes(event)||fields.length!==2||!['0','1'].includes(fields[1]))fail();
    const bytes=uint(fields[0]);if(bytes<record.bytes)fail();record.bytes=bytes;
    if(event==='destination'){
      if(record.destination||record.failed||record.name===null||bytes!==0||fields[1]!=='0')fail();
      record.destination=true;continue;
    }
    if(event==='failed'){
      if(record.failed||fields[1]!=='1')fail();record.failed=true;continue;
    }
    record.failed ||= fields[1]==='1';record.finished=true;
    if(!record.failed&&(!record.destination||record.name===null||bytes>maxBytes))fail();
  }
  const completed=[],failed=[],pending=[];
  for(const record of records.values()){
    if(!record.finished){pending.push(record.id);continue;}
    if(record.failed){failed.push(record.id);continue;}
    completed.push({id:record.id,name:record.name,bytes:record.bytes});
  }
  return {completed,failed,pending};
}
