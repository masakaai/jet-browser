// Three-way merge for allowlisted, normalized state maps. Missing keys are deletions.
// The caller must retain the common baseline and resolve conflicts explicitly.
export function mergeState(base, local, remote) {
  const merged={},conflicts=[];
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){
    const l=local[key],r=remote[key],b=base[key];
    let value;
    if(same(l,r))value=l;
    else if(same(l,b))value=r;
    else if(same(r,b))value=l;
    else {conflicts.push(key);continue;}
    if(value!==undefined)merged[key]=value;
  }
  return {merged,conflicts};
}
