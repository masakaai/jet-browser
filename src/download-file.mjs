import {constants} from 'node:fs';
import {lstat,realpath,open} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {parseDownloadJournal} from './download-journal.mjs';

// root and journal must be supplied by the trusted worker's session binding.
// This is not an authorization API; do not expose root/journal to a client.
// Parent directories must not be renameable by an untrusted local process.
export async function readCompletedDownload(root,id,journal){
  const item=parseDownloadJournal(journal).completed.find(record=>record.id===id);
  if(!item)throw Error('Download is not successfully complete');
  if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)throw Error('Invalid download directory');
  const directory=await lstat(root);
  if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(root)!==root)throw Error('Invalid download directory');
  const file=await open(join(root,item.id),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.nlink!==1n||before.size!==BigInt(item.bytes))throw Error('Download file metadata mismatch');
    const content=Buffer.alloc(item.bytes+1);let offset=0;
    while(offset<content.length){
      const {bytesRead}=await file.read(content,offset,content.length-offset,offset);
      if(!bytesRead)break;offset+=bytesRead;
    }
    const after=await file.stat({bigint:true});
    const currentDirectory=await lstat(root);
    if(offset!==item.bytes||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||after.nlink!==1n||currentDirectory.dev!==directory.dev||currentDirectory.ino!==directory.ino)throw Error('Download changed during read');
    const bytes=content.subarray(0,offset);
    return {...item,content:bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
  }finally{await file.close();}
}
