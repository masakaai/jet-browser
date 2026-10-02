const buttons=['left','middle','right'];
export function createInputState(){return {keys:new Set(),buttons:new Set()};}
export async function releaseInput(page,state){
 const errors=[];
 for(const button of [...state.buttons]){try{await page.mouse.up({button:buttons[button]});}catch(error){errors.push(error)}state.buttons.delete(button);}
 for(const key of [...state.keys]){try{await page.keyboard.up(key);}catch(error){errors.push(error)}state.keys.delete(key);}
 if(errors.length)throw errors[0];
}
export async function applyInput(page,events,state){
 try{
  for(const event of events){
   if(event.type==='pointer'){
    await page.mouse.move(event.x,event.y);
    if(event.phase==='down'&&!state.buttons.has(event.button)){await page.mouse.down({button:buttons[event.button]});state.buttons.add(event.button);}
    if(event.phase==='up'&&state.buttons.has(event.button)){await page.mouse.up({button:buttons[event.button]});state.buttons.delete(event.button);}
   }else if(event.type==='wheel'){
    await page.mouse.move(event.x,event.y);await page.mouse.wheel(event.delta_x,event.delta_y);
   }else if(event.type==='key'){
    if(event.down&&!state.keys.has(event.key)){await page.keyboard.down(event.key);state.keys.add(event.key);}
    if(!event.down&&state.keys.has(event.key)){await page.keyboard.up(event.key);state.keys.delete(event.key);}
   }else if(event.type==='text')await page.keyboard.insertText(event.text);
   else if(event.type==='release')await releaseInput(page,state);
   else throw Error('Unsupported input event');
  }
 }catch(error){await releaseInput(page,state).catch(()=>{});throw error;}
}
