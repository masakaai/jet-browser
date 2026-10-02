import {createHash, randomBytes} from 'node:crypto';
import {getPlaywrightInjectSource} from '@full-self-browsing/phantom-stream/adapters/playwright';

const STREAM_TYPES=new Set([
 'ext:dom-snapshot','ext:dom-mutations','ext:dom-scroll','ext:dom-media',
 'ext:dom-media-hint','ext:dom-overlay','ext:dom-dialog','ext:dom-ready',
 'ext:request-snapshot','ext:stream-state','ext:ps-subtree-response'
]);
export const CONTROL_TYPES=new Set(['dash:dom-stream-start','dash:ps-subtree-request']);
const MAX_MESSAGE_BYTES=2_000_000,MAX_BATCH_BYTES=2_100_000,MAX_BATCH_MESSAGES=128;

function bridgeSource(token){
 return `
	(function(){
	  // Reusing an already-installed capture must also reuse its bridge state.
	  // The capture transport closes over the bridge function that existed at
	  // construction time; replacing only window.__masakaSemanticV1 would make
	  // subsequent snapshots disappear into the old, unreachable queue.
	  if(window.__masakaSemanticV1&&window.__masakaSemanticV1.version===1&&window.__masakaSemanticV1.installed===true&&window.__phantomStreamCapture&&typeof window.__phantomStreamStart==='function'&&typeof window.__phantomStreamBridge==='function'){
	    return {installed:true,generation:Number(window.__masakaSemanticV1.generation)||0,reused:true};
	  }
	  try{if(window.__phantomStreamStop)window.__phantomStreamStop();}catch(e){}
	  // A navigation can interrupt the first injection after its guard is set
	  // but before capture construction completes. Clear that partial install
	  // so the bundled adapter is allowed to initialize atomically below.
	  try{window.__phantomStreamInjected=false;window.__phantomStreamCapture=null;window.__phantomStreamStart=null;window.__phantomStreamStop=null;window.__phantomStreamHandleControl=null;window.__phantomStreamGetNodeId=null;}catch(e){}
	  var encoder=typeof TextEncoder==='function'?new TextEncoder():null;
  var previous=window.__masakaSemanticV1;
  var generation=previous&&Number.isSafeInteger(previous.generation)?previous.generation+1:1;
  var state={version:1,generation:generation,queue:[],bytes:0,dropped:0,installed:true};
  window.__masakaSemanticV1=state;
  window.__phantomStreamBridge=function(message){
    try{
      if(!message||message.token!==${JSON.stringify(token)}||typeof message.type!=='string'||message.type.slice(0,4)!=='ext:')return false;
      var clean={type:message.type,payload:message.payload&&typeof message.payload==='object'?message.payload:{}};
	      var serialized=JSON.stringify(clean);
	      var size=encoder?encoder.encode(serialized).byteLength:serialized.length*3;
      if(size<=0||size>${MAX_MESSAGE_BYTES}){state.dropped++;return false;}
      while(state.queue.length&&((state.bytes+size)>6000000||state.queue.length>=256)){
        var removed=state.queue.shift();state.bytes=Math.max(0,state.bytes-removed.size);state.dropped++;
      }
      state.queue.push({message:clean,size:size});state.bytes+=size;return true;
    }catch(e){state.dropped++;return false;}
  };
}());
`;
}

function hybridComputedCapture(source){
 const marker='MASAKA_VISIBLE_COMPUTED_STYLE';
 if(source.includes(marker))return source;
 const relayLimitNeedle='  var RELAY_PER_MESSAGE_LIMIT_BYTES = 1048576;';
 const snapshotBudgetNeedle='  var SNAPSHOT_BUDGET_BYTES = Math.floor(RELAY_PER_MESSAGE_LIMIT_BYTES * 0.8);';
 if(!source.includes(relayLimitNeedle)||!source.includes(snapshotBudgetNeedle))throw Error('PhantomStream message budget patch point changed');
 // The MASAKA direct socket accepts a 2 MB semantic message. Keeping the
 // upstream 1 MB relay budget caused otherwise valid modern-page CSSOM to be
 // pruned from every canonical snapshot, after which a later resync could
 // overwrite the asynchronously replayed styles. Leave 100 KB for envelope
 // metadata and retain the complete CSS in the reliable snapshot when it fits.
 source=source.replace(relayLimitNeedle,'  var RELAY_PER_MESSAGE_LIMIT_BYTES = 2000000;')
  .replace(snapshotBudgetNeedle,'  var SNAPSHOT_BUDGET_BYTES = 1900000;');
 const helper=`
  // MASAKA_VISIBLE_COMPUTED_STYLE: CSSOM stays available for ordinary page
  // content. Fixed/sticky overlay subtrees carry their actual WPE computed
  // layout so auth dialogs survive cross-origin stylesheet re-fetch drift
  // without making large pages serialize every visible element's style.
  var masakaOverlayStyleCache = new WeakMap();
  var masakaOverlayComputedCount = 0;
  var masakaVisibleComputedCount = 0;
  var masakaBroadComputedFallback = false;
  function refreshMasakaComputedStylePolicy() {
    masakaOverlayStyleCache = new WeakMap();
    masakaOverlayComputedCount = 0;
    masakaVisibleComputedCount = 0;
    masakaBroadComputedFallback = false;
    try {
      var body = document.body;
      var elementCount = body && body.querySelectorAll ? body.querySelectorAll('*').length : 0;
      // A small/medium page can cheaply carry viewport computed styles when
      // one or more linked stylesheets are opaque to CSSOM. This is the
      // common failure mode for CDN-hosted SPA CSS: replaying the link in an
      // about:srcdoc mirror is best-effort, while the remote browser already
      // has the authoritative computed layout. Large document-heavy pages
      // stay on CSSOM to keep first-preview latency bounded.
      if (elementCount > 0 && elementCount <= 1400) {
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        var opaque = 0;
        for (var i = 0; i < links.length; i++) {
          try {
            var sheet = links[i].sheet;
            if (!sheet || !sheet.cssRules) opaque++;
          } catch (e) { opaque++; }
        }
        masakaBroadComputedFallback = links.length > 0 && opaque > 0;
      }
    } catch (e) { masakaBroadComputedFallback = false; }
  }
  function isFixedOverlayRoot(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    var tag = String(element.tagName || '').toLowerCase();
    var role = String(element.getAttribute('role') || '').toLowerCase();
    var tokens = String((element.getAttribute('class') || '') + ' ' + (element.id || '')).toLowerCase();
    var inlinePosition = String(element.style && element.style.position || '').toLowerCase();
    if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog'
        || element.getAttribute('aria-modal') === 'true'
        || element.hasAttribute('popover')
        || inlinePosition === 'fixed' || inlinePosition === 'sticky') return true;
    if (!/(?:^|[-_\\s])(modal|dialog|overlay|popover|popup|lightbox|alert|drawer|sheet)(?:$|[-_\\s])/.test(tokens)) return false;
    try {
      var computed = element.ownerDocument.defaultView.getComputedStyle(element);
      if (computed.position === 'fixed' || computed.position === 'sticky'
          || computed.position === 'absolute') return true;
      // Some component libraries mount a relative portal host next to their
      // fixed mask/dialog children. The host can briefly have normal flow
      // dimensions while CSS is settling and later collapse to zero height.
      // Recognizing a fixed/sticky direct child is stable across that race and
      // avoids treating ordinary static alert boxes (for example Amazon's
      // a-alert components) as overlay roots.
      var children = element.children || [];
      for (var i = 0; i < children.length; i++) {
        var childPosition = element.ownerDocument.defaultView.getComputedStyle(children[i]).position;
        if (childPosition === 'fixed' || childPosition === 'sticky') return true;
      }
      return false;
    } catch (e) { return false; }
  }
  function belongsToFixedOverlay(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (masakaOverlayStyleCache.has(element)) return masakaOverlayStyleCache.get(element);
    var own = isFixedOverlayRoot(element);
    var result = own || belongsToFixedOverlay(element.parentElement);
    masakaOverlayStyleCache.set(element, result);
    return result;
  }
  function preserveOverlayChildGeometry(element, styleText) {
    try {
      var parent = element && element.parentElement;
      if (!parent || !isFixedOverlayRoot(parent)) return styleText;
      var parentStyle = parent.ownerDocument.defaultView.getComputedStyle(parent);
      if (parentStyle.display !== 'flex' && parentStyle.display !== 'grid') return styleText;
      var rect = element.getBoundingClientRect();
      var parentRect = parent.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || parentRect.width <= 0 || parentRect.height <= 0) return styleText;
      var left = Math.round((rect.left - parentRect.left) * 1000) / 1000;
      var top = Math.round((rect.top - parentRect.top) * 1000) / 1000;
      return styleText + ';position:absolute;left:' + left + 'px;top:' + top
        + 'px;right:auto;bottom:auto;margin-top:0;margin-right:0;margin-bottom:0;margin-left:0';
    } catch (e) { return styleText; }
  }
  function preserveOverlayRootGeometry(element, styleText) {
    try {
      if (!isFixedOverlayRoot(element)) return styleText;
      var rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return styleText;
      var width = Math.round(rect.width * 1000) / 1000;
      var height = Math.round(rect.height * 1000) / 1000;
      return styleText + ';width:' + width + 'px;height:' + height
        + 'px;min-width:0;min-height:0';
    } catch (e) { return styleText; }
  }
  function shouldCaptureVisibleComputedStyle(element) {
    try {
      if (!element || !element.getBoundingClientRect) return false;
      var overlay = belongsToFixedOverlay(element);
      if (!overlay && !masakaBroadComputedFallback) return false;
      // Hidden and zero-footprint portal roots are correctness-critical: if
      // their geometry is omitted after a large dialog consumes the overlay
      // budget, the mirror may expand a transparent host over the whole page.
      // Keep this small root-only exception ahead of the descendant budget.
      if (isFixedOverlayRoot(element)) {
        var rootStyle = element.ownerDocument.defaultView.getComputedStyle(element);
        var rootRect = element.getBoundingClientRect();
        if (rootStyle.display === 'none' || rootStyle.visibility === 'hidden'
            || rootStyle.opacity === '0' || rootRect.width <= 0
            || rootRect.height <= 0) {
          masakaOverlayComputedCount++;
          return true;
        }
      }
      if (overlay && masakaOverlayComputedCount >= 128) return false;
      if (!overlay && masakaVisibleComputedCount >= 512) return false;
      var rect = element.getBoundingClientRect();
      var view = element.ownerDocument && element.ownerDocument.defaultView
        ? element.ownerDocument.defaultView : window;
      var margin = 96;
      var visible = rect.width > 0 && rect.height > 0
        && rect.bottom >= -margin && rect.right >= -margin
        && rect.top <= view.innerHeight + margin
        && rect.left <= view.innerWidth + margin;
      if (visible) {
        if (overlay) masakaOverlayComputedCount++;
        else masakaVisibleComputedCount++;
      }
      return visible;
    } catch (e) { return false; }
  }

  function collectVisibleSubtreeComputedStyles(root) {
    var styles = new WeakMap();
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return styles;
    var elements = [root];
    if (root.querySelectorAll) {
      var descendants = root.querySelectorAll('*');
      for (var i = 0; i < descendants.length; i++) elements.push(descendants[i]);
    }
    for (var n = 0; n < elements.length; n++) {
      if (!shouldCaptureVisibleComputedStyle(elements[n])) continue;
      var styleText = preserveOverlayRootGeometry(elements[n],
        preserveOverlayChildGeometry(
          elements[n], collectComputedStyleText(elements[n], CURATED_PROPS)));
      if (styleText) styles.set(elements[n], styleText);
    }
    return styles;
  }
`;
 const helperNeedle='  function captureComputedStyles(original, clone) {';
 if(!source.includes(helperNeedle))throw Error('PhantomStream computed-style patch point changed');
 let next=source.replace(helperNeedle,helper+'\n'+helperNeedle);
 const captureStyleNeedle="  function captureComputedStyles(original, clone) {\n    var styleText = collectComputedStyleText(original, CURATED_PROPS);";
 if(!next.includes(captureStyleNeedle))throw Error('PhantomStream element-style patch point changed');
 next=next.replace(captureStyleNeedle,"  function captureComputedStyles(original, clone) {\n    var styleText = preserveOverlayRootGeometry(original, preserveOverlayChildGeometry(original, collectComputedStyleText(original, CURATED_PROPS)));");
 const serializeNeedle="  function serializeDOM() {\n";
 if(!next.includes(serializeNeedle))throw Error('PhantomStream snapshot-style cache patch point changed');
 next=next.replace(serializeNeedle,"  function serializeDOM() {\n    refreshMasakaComputedStylePolicy();\n");
 const addedNeedle="  function processAddedNode(el) {\n";
 if(!next.includes(addedNeedle))throw Error('PhantomStream added-node style budget patch point changed');
 next=next.replace(addedNeedle,"  function processAddedNode(el) {\n    masakaOverlayStyleCache = new WeakMap();\n    masakaOverlayComputedCount = 0;\n    masakaVisibleComputedCount = 0;\n");
 const capturePattern=/if \(styleMode !== 'cssom'\) captureComputedStyles\((\w+), (\w+)\);/g;
 let captureCount=0;
 next=next.replace(capturePattern,(match,original,clone)=>{
  captureCount++;
  return `if (styleMode !== 'cssom' || shouldCaptureVisibleComputedStyle(${original})) captureComputedStyles(${original}, ${clone});`;
 });
 if(captureCount!==3)throw Error(`PhantomStream visible-style capture patch count changed (${captureCount})`);
 const subtreeNeedle="var computedStyles = styleMode === 'cssom' ? new WeakMap() : collectSubtreeComputedStyles(el);";
 if(!next.includes(subtreeNeedle))throw Error('PhantomStream added-subtree style patch point changed');
 next=next.replace(subtreeNeedle,"var computedStyles = styleMode === 'cssom' ? collectVisibleSubtreeComputedStyles(el) : collectSubtreeComputedStyles(el);");
 const frameCloneNeedle='  function prepareFrameDocumentClone(frameDoc, bodyClone, cloneToNid) {';
 if(!next.includes(frameCloneNeedle))throw Error('PhantomStream stylesheet-load patch point changed');
 const stylesheetLoadHelper=`
  // MASAKA_STYLESHEET_LOAD_RECONCILE: a dynamically inserted <link> is
  // visible to MutationObserver before its CSSOM is available. Reconcile the
  // document scope on load so the mirror receives the late stylesheet as a
  // bounded style-source diff instead of remaining on the initial fallback.
  var masakaObservedStylesheetLinks = typeof WeakSet === 'function' ? new WeakSet() : null;
  function observeMasakaStylesheetLoads(root) {
    if (styleMode !== 'cssom' || !root) return;
    var links = [];
    try {
      if (root.nodeType === Node.ELEMENT_NODE
          && String(root.tagName || '').toLowerCase() === 'link'
          && String(root.getAttribute('rel') || '').toLowerCase().split(/\\s+/).indexOf('stylesheet') !== -1) links.push(root);
      if (root.querySelectorAll) {
        var descendants = root.querySelectorAll('link[rel~="stylesheet"]');
        for (var i = 0; i < descendants.length; i++) links.push(descendants[i]);
      }
    } catch (e) { return; }
    for (var n = 0; n < links.length; n++) {
      var link = links[n];
      if (masakaObservedStylesheetLinks && masakaObservedStylesheetLinks.has(link)) continue;
      if (masakaObservedStylesheetLinks) masakaObservedStylesheetLinks.add(link);
      link.addEventListener('load', function() {
        queueStyleScopeReplacement({ kind: 'document' }, document, 'stylesheet-loaded');
      }, { once: true });
    }
  }

`;
 next=next.replace(frameCloneNeedle,stylesheetLoadHelper+frameCloneNeedle);
 const observerNeedle=`    mutationObserver = new MutationObserver(function(mutations) {
      // Accumulate mutations`;
 if(!next.includes(observerNeedle))throw Error('PhantomStream stylesheet observer patch point changed');
 next=next.replace(observerNeedle,`    mutationObserver = new MutationObserver(function(mutations) {
      if (styleMode === 'cssom') {
        var masakaStyleTreeChanged = false;
        for (var sm = 0; sm < mutations.length; sm++) {
          var styleMutation = mutations[sm];
          if (styleMutation.type === 'childList') {
            for (var sa = 0; sa < styleMutation.addedNodes.length; sa++) {
              observeMasakaStylesheetLoads(styleMutation.addedNodes[sa]);
            }
            // CSS-in-JS libraries commonly append already-populated <style>
            // elements to <head>. There is no link load event in that path,
            // and <head> has no mirror node id, so the ordinary add diff is
            // intentionally skipped. Reconcile the CSSOM scope itself.
            if (document.head && (styleMutation.target === document.head
                || document.head.contains(styleMutation.target))) {
              masakaStyleTreeChanged = true;
            }
          } else if (styleMutation.type === 'attributes') {
            var mutationTag = String(styleMutation.target && styleMutation.target.tagName || '').toLowerCase();
            if (mutationTag === 'style' || mutationTag === 'link') masakaStyleTreeChanged = true;
          }
        }
        if (masakaStyleTreeChanged) {
          queueStyleScopeReplacement({ kind: 'document' }, document, 'stylesheet-tree-changed');
        }
      }
      // Accumulate mutations`);
 const initialObserveNeedle='    pendingMutations = [];\n    observedShadowRoots = new WeakSet();';
 if(!next.includes(initialObserveNeedle))throw Error('PhantomStream initial stylesheet observer patch point changed');
 next=next.replace(initialObserveNeedle,'    pendingMutations = [];\n    observeMasakaStylesheetLoads(document);\n    observedShadowRoots = new WeakSet();');
 const streamStartedNeedle='    streaming = true;\n    broadcastOverlayState(true);';
 if(!next.includes(streamStartedNeedle))throw Error('PhantomStream post-snapshot stylesheet patch point changed');
 next=next.replace(streamStartedNeedle,`    streaming = true;
    // MASAKA_POST_SNAPSHOT_STYLE_REPLAY: the canonical snapshot may shed the
    // last CSSOM sources to stay under PhantomStream's per-message budget.
    // Replay every document source as independently bounded mutation chunks
    // after the snapshot, including stylesheets that had already loaded
    // before capture was injected and therefore cannot emit a load event.
    if (styleMode === 'cssom') {
      queueStyleScopeReplacement({ kind: 'document' }, document, 'post-snapshot-style-replay');
    }
    broadcastOverlayState(true);`);
 const attrNeedle=`        diffs.push(scopeFrameDiff({
          op: 'attr',
          nid: targetNid,
          attr: m.attributeName,
          val: attrResult.value
        }, frameRecord));`;
 if(!next.includes(attrNeedle))throw Error('PhantomStream attribute-style patch point changed');
 const attrReplacement=attrNeedle+`
        if (styleMode === 'cssom'
            && (attrNameLower === 'class' || attrNameLower === 'style')
            && (masakaOverlayStyleCache.delete(m.target), shouldCaptureVisibleComputedStyle(m.target))) {
          var liveStyleText = preserveOverlayRootGeometry(m.target,
            preserveOverlayChildGeometry(
              m.target, collectComputedStyleText(m.target, CURATED_PROPS)));
          diffs.push(scopeFrameDiff({
            op: 'attr', nid: targetNid, attr: 'style',
            val: sanitizeForWire('css', { css: liveStyleText }).css
          }, frameRecord));
        }`;
 return next.replace(attrNeedle,attrReplacement);
}

export function semanticInjectionSource(){
 const token=randomBytes(24).toString('base64url');
 const capture=hybridComputedCapture(getPlaywrightInjectSource({bridgeToken:token,captureOptions:{styleMode:'cssom'}}));
 return `${bridgeSource(token)}\n${capture}\nreturn {installed:Boolean(window.__masakaSemanticV1&&window.__phantomStreamCapture),generation:window.__masakaSemanticV1&&window.__masakaSemanticV1.generation};`;
}

export function normalizeSemanticBatch(value){
 const source=value&&typeof value==='object'?value:{};
 const messages=[];let rejected=0;
 for(const candidate of Array.isArray(source.messages)?source.messages:[]){
  if(!candidate||typeof candidate!=='object'||!STREAM_TYPES.has(candidate.type))continue;
  const payload=candidate.payload&&typeof candidate.payload==='object'?candidate.payload:{};
  const bytes=Buffer.byteLength(JSON.stringify({type:candidate.type,payload}));
  if(bytes<=MAX_MESSAGE_BYTES)messages.push({type:candidate.type,payload,bytes});
  else rejected++;
  if(messages.length>=MAX_BATCH_MESSAGES)break;
 }
 return {
  installed:source.installed===true,
  generation:Number.isSafeInteger(source.generation)?source.generation:0,
  dropped:Number.isSafeInteger(source.dropped)&&source.dropped>0?source.dropped:0,
  pending:Number.isSafeInteger(source.pending)&&source.pending>0?source.pending:0,
  rejected,
  messages
 };
}

export async function waitForSemanticPageReady(engine,{timeoutMs=8000,quietMs=2500,pollMs=100}={}){
 const deadline=Date.now()+Math.max(0,timeoutMs);let signature='',stableAt=0,last=null;
 do{
  last=await engine.documentState();
  const next=`${last?.url||''}\n${Number(last?.timeOrigin)||0}\n${Number(last?.styleSheets)||0}\n${Number(last?.stylesheetLinks)||0}\n${Number(last?.pendingStyles)||0}`;
  if(next!==signature){signature=next;stableAt=Date.now();}
  const ready=last?.readyState==='complete'&&Number(last?.pendingStyles||0)===0;
  if(ready&&Date.now()-stableAt>=Math.max(0,quietMs))return last;
  if(Date.now()>=deadline)break;
  await new Promise(resolve=>setTimeout(resolve,Math.max(1,pollMs)));
 }while(true);
 // Some sites intentionally keep stylesheet links unresolved. Capture still
 // has an href/computed-style fallback, so the bounded readiness gate must not
 // turn a fidelity improvement into a session startup failure.
 return last;
}

export async function prepareSemanticPreview(engine,{attempts=2,polls=20,pollMs=100}={}){
 let failure;
 for(let attempt=0;attempt<Math.max(1,attempts);attempt++){
  try{
   let batch=normalizeSemanticBatch(await engine.drainSemantic(MAX_BATCH_BYTES,MAX_BATCH_MESSAGES));
   if(!batch.installed)throw Error('Live DOM capture detached during startup');
   let snapshotIndex=batch.messages.findLastIndex(message=>message.type==='ext:dom-snapshot');
   if(snapshotIndex<0){
    await engine.semanticControl('dash:dom-stream-start',{trigger:'startup-preflight',attempt:attempt+1});
    // PhantomStream snapshots can complete on a later animation frame. Poll
    // the already-installed bridge for a bounded interval instead of
    // immediately tearing it down and losing the in-flight canonical frame.
    for(let poll=0;poll<Math.max(1,polls)&&snapshotIndex<0;poll++){
     if(poll>0&&pollMs>0)await new Promise(resolve=>setTimeout(resolve,pollMs));
     batch=normalizeSemanticBatch(await engine.drainSemantic(MAX_BATCH_BYTES,MAX_BATCH_MESSAGES));
     if(!batch.installed)throw Error('Live DOM capture detached during startup');
     snapshotIndex=batch.messages.findLastIndex(message=>message.type==='ext:dom-snapshot');
    }
   }
   if(snapshotIndex>=0)return {generation:batch.generation,messages:batch.messages.slice(snapshotIndex)};
   failure=Error('Live DOM did not produce an initial snapshot');
  }catch(error){
   if(error.driverRestartRequired||error.driverReusable===false)throw error;
   failure=error;
  }
 }
 throw failure||Error('Live DOM did not produce an initial snapshot');
}

export function semanticEnvelope(message){
 const json=JSON.stringify({type:message.type,payload:message.payload});
 const buffer=Buffer.from(json);
 if(buffer.length>MAX_MESSAGE_BYTES)throw Error('Semantic preview message exceeds transport limit');
 return {id:createHash('sha256').update(buffer).digest('base64url').slice(0,20),buffer};
}

export const semanticLimits={batchBytes:MAX_BATCH_BYTES,batchMessages:MAX_BATCH_MESSAGES,messageBytes:MAX_MESSAGE_BYTES};
