const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const toast=$('#toast');let toastTimer;
function notify(message){toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),2600)}
async function copyCommand(value){try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(value)}else{const input=document.createElement('textarea');input.value=value;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();if(!document.execCommand('copy'))throw new Error('copy');input.remove()}notify(`Copiado: ${value.split(' --')[0]}`)}catch{notify('Não foi possível copiar. Selecione o comando no catálogo.')}}
document.addEventListener('click',e=>{const button=e.target.closest('[data-copy]');if(button)copyCommand(button.dataset.copy)});
function updateVideoButton(video){const button=$(`[data-video-toggle="${video.id}"]`);if(!button)return;button.setAttribute('aria-label',video.paused?'Reproduzir demonstração':'Pausar demonstração');button.innerHTML=video.paused?'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 7 5-7 5Z"/></svg>':'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 5v10M13 5v10"/></svg>'}
$$('[data-video-toggle]').forEach(button=>{const video=document.getElementById(button.dataset.videoToggle);button.addEventListener('click',()=>video.paused?video.play().catch(()=>notify('A demonstração está carregando. Tente novamente.')):video.pause());video.addEventListener('play',()=>updateVideoButton(video));video.addEventListener('pause',()=>updateVideoButton(video))});
const hero=$('#hero-video');if(reducedMotion.matches){hero.removeAttribute('autoplay');hero.pause();updateVideoButton(hero)}
const dialog=$('#demo-dialog'),fullDemo=$('#full-demo');let dialogReturnFocus;
$$('.open-demo').forEach(button=>button.addEventListener('click',()=>{dialogReturnFocus=document.activeElement;$$('video').forEach(v=>v.pause());fullDemo.src='assets/hero-demo.mp4';dialog.showModal();fullDemo.play().catch(()=>{});$('#close-demo').focus()}));
function closeDemo(){fullDemo.pause();dialog.close()}
$('#close-demo').addEventListener('click',closeDemo);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDemo()}});dialog.addEventListener('close',()=>{fullDemo.pause();dialogReturnFocus?.focus()});
const features={
conversa:{index:'01 / CONVERSA',title:'Escreva como você fala.',description:'“Tire as pausas e aproxime quando eu explicar a ideia.” O agente usa as ferramentas do editor, mostra o andamento e aplica a edição na timeline.',points:['Progresso em tempo real','Modelo e raciocínio à sua escolha','Cancelar, conferir e desfazer'],video:'demo-chat.mp4',poster:'app-dark.webp',alt:'Conversa no CutRoom com etapas do agente e timeline',link:'Como conectar sua IA',url:'https://github.com/Mathpcastro/cutroom#instalar-e-conectar'},
comandos:{index:'02 / 38 COMANDOS',title:'Um + abre possibilidades.',description:'Busque um comando, veja o que ele faz e ajuste o texto, o intervalo ou a intensidade. Ou digite / direto no chat. Sem decorar sequências de cliques.',points:['37 ações prontas sem conectar IA','Intervalos e parâmetros ajustáveis','Cada edição pode ser desfeita'],video:'demo-commands.mp4',poster:'commands.webp',alt:'Catálogo real de comandos do CutRoom',link:'Explore todos os comandos',url:'#comandos'},
legendas:{index:'03 / 24 ESTILOS',title:'Sua voz ganha presença.',description:'Karaokê, frases, destaque por palavra e estilos personalizados. Ajuste a aparência, veja no player e salve sua identidade para os próximos projetos.',points:['24 presets, seis famílias de fontes','Cores, posição e animações editáveis','Transcrição local com tempos por palavra'],video:'demo-captions.mp4',poster:'captions.webp',alt:'Estúdio de legendas com prévia real no vídeo',link:'Veja o estúdio de legendas',url:'https://github.com/Mathpcastro/cutroom/blob/main/docs/captions.md'},
efeitos:{index:'04 / EFEITOS',title:'Dê movimento à explicação.',description:'Títulos e destaques sobre sua gravação. Diagramas e etapas em tela cheia. Use um modelo pronto ou peça uma cena original à sua IA com /animar.',points:['Sua voz continua durante a animação','Prévia sincronizada com a timeline','Exportação local com o pacote de efeitos'],video:'demo-effects.mp4',poster:'effects.webp',alt:'Efeitos e animações em uma timeline real do CutRoom',link:'Conheça os efeitos',url:'https://github.com/Mathpcastro/cutroom/blob/main/docs/motion.md'},
timeline:{index:'05 / TIMELINE',title:'A edição continua nas suas mãos.',description:'Confira cada corte, divida um clipe, ajuste zoom, foco, velocidade e áudio. O chat e os controles manuais trabalham no mesmo projeto.',points:['Desfazer e refazer alterações','Salvar e reabrir seu projeto','Exportar em MP4 H.264/AAC'],video:'demo-timeline.mp4',poster:'timeline.webp',alt:'Timeline do CutRoom com cortes, áudio e efeitos',link:'Veja como começar',url:'#como-comecar'},
temas:{index:'06 / SEIS TEMAS',title:'Seu espaço para criar.',description:'Grafite, Claro, Dark+, Light+, Nord e Tokyo Night. Uma interface discreta, com menus compactos e painéis que aparecem quando você precisa.',points:['Tema salvo entre sessões','Escolha um visual claro ou escuro','Foco no vídeo e na conversa'],image:'app-dark.webp',alt:'CutRoom no tema Grafite',link:'Baixar e escolher meu tema',url:'https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom.Setup.0.6.1.exe'}
};
const explorerVideo=$('#explorer-video'),explorerImage=$('#explorer-image'),explorerPanel=$('#explorer-panel');let activeFeature='overview',featureVisible=false;
function setFeature(id,{focus=false}={}) {
  const isOverview=id==='overview',f=features[id];
  if(!isOverview&&!f)return;
  activeFeature=id;
  updateHeroContext(id);
  alignWorkbenchIfNeeded();
  $$('button[role="tab" ][data-feature]').forEach(tab=>{const selected=tab.dataset.feature===id;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus({preventScroll:true});if(selected){const dock=tab.parentElement;if(tab.offsetLeft<dock.scrollLeft||tab.offsetLeft+tab.offsetWidth>dock.scrollLeft+dock.clientWidth)dock.scrollTo({left:Math.max(0,tab.offsetLeft-10),behavior:reducedMotion.matches?'auto':'smooth'})}});
  $('#overview-panel').hidden=!isOverview;
  explorerPanel.hidden=isOverview;
  explorerVideo.pause();hero.pause();
  if(isOverview){if(!reducedMotion.matches&&!anyDialogOpen())hero.play().catch(()=>{});return}
  explorerPanel.setAttribute('aria-labelledby',`tab-${id}`);
  $('#feature-index').textContent=f.index;$('#feature-title').textContent=f.title;$('#feature-description').textContent=f.description;
  $('#feature-points').replaceChildren(...f.points.map(point=>{const el=document.createElement('span');el.textContent=point;return el}));
  $('#feature-link').textContent=f.link+' ↗';$('#feature-link').href=f.url;
  if(f.url.startsWith('#')){$('#feature-link').removeAttribute('target');$('#feature-link').removeAttribute('rel')}else{$('#feature-link').target='_blank';$('#feature-link').rel='noopener'}
  $('#theme-switch').hidden=id!=='temas';explorerVideo.hidden=!!f.image;explorerImage.hidden=!f.image;$('[data-video-toggle="explorer-video"]').hidden=!!f.image;
  if(f.image){explorerVideo.removeAttribute('src');explorerVideo.load();setPreviewTheme('dark')}
  else{explorerVideo.poster=`assets/${f.poster}`;explorerVideo.setAttribute('aria-label',f.alt);explorerVideo.dataset.src=`assets/${f.video}`;explorerVideo.src=explorerVideo.dataset.src;explorerVideo.load();if(!reducedMotion.matches&&!anyDialogOpen())explorerVideo.play().catch(()=>{})}
}

$$('button[role="tab" ][data-feature]').forEach(tab=>{tab.addEventListener('click',()=>setFeature(tab.dataset.feature));tab.addEventListener('keydown',e=>{const tabs=$$('button[role="tab" ][data-feature]'),index=tabs.indexOf(tab);let next;if(e.key==='ArrowRight')next=(index+1)%tabs.length;if(e.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();setFeature(tabs[next].dataset.feature,{focus:true})}})});
function setPreviewTheme(theme){explorerImage.src=`assets/app-${theme}.webp`;explorerImage.alt=`CutRoom no tema ${theme==='dark'?'Grafite':'Claro'}`;$$('[data-theme-preview]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themePreview===theme)))}
$$('[data-theme-preview]').forEach(b=>b.addEventListener('click',()=>setPreviewTheme(b.dataset.themePreview)));$$('[data-feature-jump]').forEach(b=>b.addEventListener('click',()=>{setFeature(b.dataset.featureJump);$('#em-acao').scrollIntoView({behavior:reducedMotion.matches?'auto':'smooth'})}));
const videoObserver=new IntersectionObserver(entries=>entries.forEach(({target:video,isIntersecting})=>{if(isIntersecting){if(video.dataset.src&&!video.getAttribute('src')){video.src=video.dataset.src;video.load()}if(!reducedMotion.matches&&!anyDialogOpen()&&!video.dataset.userPaused)video.play().catch(()=>{})}else video.pause()}),{rootMargin:'100px 0px',threshold:.15});$$('.lazy-video').forEach(v=>videoObserver.observe(v));new IntersectionObserver(entries=>entries.forEach(entry=>{featureVisible=entry.isIntersecting;if(featureVisible&&activeFeature!=='temas'&&activeFeature!=='overview'){if(!explorerVideo.getAttribute('src')){explorerVideo.src=explorerVideo.dataset.src;explorerVideo.load()}if(!reducedMotion.matches&&!anyDialogOpen()&&!explorerVideo.dataset.userPaused)explorerVideo.play().catch(()=>{})}else explorerVideo.pause()}),{threshold:.2}).observe(explorerPanel);explorerVideo.dataset.src='assets/demo-chat.mp4';
new IntersectionObserver(entries=>entries.forEach(entry=>{if(!entry.isIntersecting)hero.pause();else if(activeFeature==='overview'&&!reducedMotion.matches&&!anyDialogOpen()&&!hero.dataset.userPaused)hero.play().catch(()=>{})}),{threshold:.1}).observe(hero);$('[data-video-toggle="hero-video"]').addEventListener('click',()=>{hero.dataset.userPaused=hero.paused?'true':''});
let commands=[],category='Todos',catalogExpanded=false;const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function renderCommands(){
 const query=normalize($('#command-search').value.trim().replace(/^\//,''));
 const filtered=commands.filter(c=>(category==='Todos'||c.category===category)&&normalize(`${c.id} ${c.label} ${c.description} ${c.category}`).includes(query));
 const isFiltered=!!query||category!=='Todos',shown=catalogExpanded||isFiltered?filtered:filtered.slice(0,8);
 $('#command-count').textContent=`${filtered.length} ${filtered.length===1?'comando':'comandos'}`;
 const more=$('#show-all-commands');more.parentElement.hidden=isFiltered||filtered.length<=8;more.setAttribute('aria-expanded',String(catalogExpanded));more.innerHTML=catalogExpanded?'Mostrar menos <span aria-hidden="true">↑</span>':'Ver todos os 38 comandos <span aria-hidden="true">↓</span>';
 const catalog=$('#command-catalog');catalog.replaceChildren();
 if(!filtered.length){const p=document.createElement('p');p.className='catalog-empty';p.textContent='Nenhum comando por aqui. Tente “zoom”, “legenda” ou outra categoria.';catalog.append(p);return}
 for(const c of shown){const b=document.createElement('button');b.type='button';b.className='command-row';b.dataset.copy=c.example;b.setAttribute('aria-label',`Copiar exemplo de /${c.id}: ${c.description}`);const head=document.createElement('div'),code=document.createElement('code'),tag=document.createElement('span'),desc=document.createElement('span'),copy=document.createElement('span');code.textContent=`/${c.id}`;tag.className=`command-tag${c.kind==='ai'?' ai':''}`;tag.textContent=c.kind==='ai'?'REQUER IA':c.category;head.append(code,tag);desc.className='command-desc';desc.textContent=c.description;copy.className='command-copy';copy.innerHTML=icon('copy');copy.setAttribute('aria-hidden','true');b.append(head,desc,copy);catalog.append(b)}
}
$('#show-all-commands').addEventListener('click',()=>{catalogExpanded=!catalogExpanded;renderCommands();if(!catalogExpanded)$('#comandos').scrollIntoView({behavior:reducedMotion.matches?'auto':'smooth'})});

fetch('assets/commands.json').then(r=>{if(!r.ok)throw new Error('catalog');return r.json()}).then(data=>{commands=data;renderCommands()}).catch(()=>{$('#command-catalog').innerHTML='<p class="catalog-empty">Não foi possível carregar o catálogo. <a href="https://github.com/Mathpcastro/cutroom/blob/main/docs/commands.md">Veja todos os comandos no GitHub ↗</a></p>'});
$('#command-search').addEventListener('input',renderCommands);$$('[data-category]').forEach(button=>button.addEventListener('click',()=>{category=button.dataset.category;$$('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));renderCommands()}));
document.addEventListener('keydown',e=>{if(e.key==='/'&&!e.ctrlKey&&!e.metaKey&&!anyDialogOpen()&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#command-search').focus();$('#comandos').scrollIntoView({behavior:reducedMotion.matches?'auto':'smooth'})}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)$$('video').forEach(video=>video.pause())});

function icon(name){const paths={overview:'<rect x="3" y="3" width="14" height="14" rx="3"/><path d="m8 7 5 3-5 3Z"/>',conversa:'<path d="M17 9.5a6.5 6.5 0 0 1-6.5 6.5H4l-2 2V9.5A6.5 6.5 0 0 1 8.5 3h2A6.5 6.5 0 0 1 17 9.5Z"/><path d="M6 8h7M6 11h4"/>',comandos:'<path d="m7 4-4 6 4 6m6-12 4 6-4 6M11 3 9 17"/>',legendas:'<rect x="2.5" y="4" width="15" height="12" rx="2.5"/><path d="M6 9.5h3M6 12h2m3-2.5h3m-3 2.5h2"/>',efeitos:'<path d="m10 2 2.1 5.9L18 10l-5.9 2.1L10 18l-2.1-5.9L2 10l5.9-2.1L10 2ZM16 2v3m-1.5-1.5h3"/>',timeline:'<rect x="2" y="5" width="16" height="4" rx="1"/><rect x="2" y="12" width="6" height="3" rx="1"/><rect x="10" y="12" width="8" height="3" rx="1"/><path d="M7 2v16"/>',temas:'<circle cx="10" cy="10" r="3.5"/><path d="M10 1v2m0 14v2M1 10h2m14 0h2M3.6 3.6 5 5m10 10 1.4 1.4M3.6 16.4 5 15m10-10 1.4-1.4"/>',copy:'<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3"/>',arrow:'<path d="M5 15 15 5M5 5h10v10"/>',play:'<path d="m7 4 9 6-9 6Z"/>',pause:'<path d="M7 4v12m6-12v12"/>'};return `<svg viewBox="0 0 20 20" aria-hidden="true">${paths[name]||paths.arrow}</svg>`}
$$('button[role="tab" ][data-feature]').forEach(tab=>{const label=tab.textContent.replace('↗','').trim();tab.innerHTML=icon(tab.dataset.feature)+`<span>${label}</span>`});
$$('.command-chip .copy-icon').forEach(el=>el.innerHTML=icon('copy'));
$$('.effect-commands .arrow').forEach(el=>el.innerHTML=icon('arrow'));
$$('.lazy-video').forEach((video,index)=>{video.id=`story-video-${index}`;const button=document.createElement('button');button.type='button';button.className='film-toggle story-toggle';button.dataset.videoToggle=video.id;button.setAttribute('aria-label','Pausar demonstração');button.innerHTML=icon('pause');video.parentElement.append(button);button.addEventListener('click',()=>{if(video.paused){delete video.dataset.userPaused;video.play().catch(()=>notify('A demonstração está carregando. Tente novamente.'))}else{video.dataset.userPaused='true';video.pause()}});video.addEventListener('play',()=>updateVideoButton(video));video.addEventListener('pause',()=>updateVideoButton(video))});
let parallaxPending=false;
function updateParallax(){parallaxPending=false;if(reducedMotion.matches)return;const stage=$('.hero-stage'),r=stage.getBoundingClientRect();const progress=Math.min(1,Math.max(0,(innerHeight*.6-r.top)/(innerHeight+r.height)));stage.style.transform=`translate3d(0,${(progress*18).toFixed(2)}px,0)`;$('.hero-dock').style.transform=`translate3d(0,${(progress*5).toFixed(2)}px,0)`}
window.addEventListener('scroll',()=>{if(!parallaxPending){parallaxPending=true;requestAnimationFrame(updateParallax)}},{passive:true});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches){$('.hero-stage').style.transform='none';$('.hero-dock').style.transform='none';$$('video').forEach(video=>video.pause())}else updateParallax()});
updateParallax();

// The interactive component fits the viewport; the headline can live above it.
const compactDesktop=window.matchMedia('(min-width: 1000px)');
const heroLayout=$('.hero-layout'),featureDetails=$('#feature-details');
function updateHeroContext(id){heroLayout.dataset.activeFeature=id;featureDetails.hidden=id==='overview'}
function syncHeroDetails(){$('.hero-context').append(featureDetails);updateHeroContext(activeFeature);fitHeroWorkbench()}
function fitHeroWorkbench(){
 const stage=$('.hero-stage'),workbench=$('.hero-workbench'),dock=$('.hero-dock'),context=$('.hero-context'),caption=$('.hero-workbench .film-caption');
 const dockStyle=getComputedStyle(dock),contextStyle=getComputedStyle(context);
 const available=innerHeight-32-dock.offsetHeight-parseFloat(dockStyle.marginBottom)-context.offsetHeight-parseFloat(contextStyle.marginBottom)-caption.offsetHeight-12;
 const height=Math.max(120,Math.floor(Math.min(650,workbench.clientWidth/1.6,available)));
 stage.style.height=`${height}px`;stage.style.width=`${height*1.6}px`;caption.style.width=`${height*1.6}px`;
}
function alignWorkbenchIfNeeded(){
 const workbench=$('.hero-workbench'),dock=$('.hero-dock'),stage=$('.hero-stage'),caption=$('.hero-workbench .film-caption');
 const top=workbench.getBoundingClientRect().top,bottom=caption.getBoundingClientRect().bottom;
 if(top<8||bottom>innerHeight-12)window.scrollTo({top:scrollY+top-16,behavior:reducedMotion.matches?'auto':'smooth'});
}
let fitFrame=0;window.addEventListener('resize',()=>{cancelAnimationFrame(fitFrame);fitFrame=requestAnimationFrame(fitHeroWorkbench)},{passive:true});
syncHeroDetails();document.fonts.ready.then(fitHeroWorkbench);

// Downloads are released only after the server confirms a saved registration.
function anyDialogOpen(){return !!document.querySelector('dialog[open]')}
const downloadModal=$('#download-dialog'),downloadForm=$('#download-form'),downloadSubmit=$('.download-submit'),downloadSuccess=$('#download-success'),downloadReady=$('#download-ready');
const downloadInputs={name:$('#download-name'),whatsapp:$('#download-whatsapp'),email:$('#download-email')};
const downloadPlatform=$('#download-platform');
const officialInstallers={
  windows:'https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom.Setup.0.6.1.exe',
  'macos-arm64':'https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom-0.6.1-mac-arm64.dmg',
  'macos-x64':'https://github.com/Mathpcastro/cutroom/releases/download/v0.6.1/CutRoom-0.6.1-mac-x64.dmg'
};
let downloadReturnFocus=null,downloadBusy=false,downloadController=null,downloadRequestEpoch=0;
function clearDownloadErrors(){
  for(const key of Object.keys(downloadInputs)){downloadInputs[key].removeAttribute('aria-invalid');const error=$(`#download-${key}-error`);error.textContent='';error.hidden=true}
  $('#download-form-error').textContent='';$('#download-form-error').hidden=true;$('#download-form-status').textContent='';
}
function setDownloadBusy(busy){
  downloadBusy=busy;downloadForm.setAttribute('aria-busy',String(busy));downloadSubmit.disabled=busy;
  for(const input of Object.values(downloadInputs))input.disabled=busy;downloadPlatform.disabled=busy;
  $('span',downloadSubmit).textContent=busy?'Preparando seu download…':'Baixar grátis';
  $('#download-form-status').textContent=busy?'Registrando seu download…':'';
}
function showDownloadErrors(fields={},message=''){
  clearDownloadErrors();let first=null;
  for(const key of Object.keys(downloadInputs)){if(typeof fields[key]!=='string'||!fields[key])continue;const error=$(`#download-${key}-error`);error.textContent=fields[key].slice(0,250);error.hidden=false;downloadInputs[key].setAttribute('aria-invalid','true');first??=downloadInputs[key]}
  if(message){$('#download-form-error').textContent=message;$('#download-form-error').hidden=false}
  if(typeof fields.platform==='string'&&fields.platform){const error=$('#download-platform-error');error.textContent=fields.platform.slice(0,250);error.hidden=false;downloadPlatform.setAttribute('aria-invalid','true');first??=downloadPlatform}
  first?.focus();
}
function validateDownloadFields(){
  const fields={},name=downloadInputs.name.value.trim(),email=downloadInputs.email.value.trim(),phone=downloadInputs.whatsapp.value.trim(),digits=phone.replace(/\D/g,'');
  if(!Object.hasOwn(officialInstallers,downloadPlatform.value))fields.platform='Escolha seu sistema para baixar a versão correta.';
  if(name.length<2||name.length>100||!/[\p{L}]/u.test(name))fields.name='Informe seu nome.';
  const brazil=digits.startsWith('55')&&[12,13].includes(digits.length)?digits.slice(2):digits;
  const validBrazil=[10,11].includes(brazil.length)&&/^[1-9]\d/.test(brazil);
  const international=phone.startsWith('+')&&!digits.startsWith('55')&&/^[1-9]/.test(digits)&&digits.length>=10&&digits.length<=15;
  if(!/^\+?[\d\s().-]+$/.test(phone)||phone.length>32||!(international||validBrazil))fields.whatsapp='Informe um WhatsApp com DDD ou +código do país.';
  if(email.length>254||!downloadInputs.email.validity.valid||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fields.email='Informe um e-mail válido.';
  return fields;
}
function openDownloadForm(trigger){
  downloadReturnFocus=trigger;$$('video').forEach(video=>video.pause());
  downloadForm.hidden=false;downloadSuccess.hidden=true;clearDownloadErrors();
  downloadModal.showModal();downloadPlatform.focus();
}
document.addEventListener('click',event=>{
  const trigger=event.target.closest('a.download');
  if(!trigger||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();if(!downloadModal.open)openDownloadForm(trigger);
});
$('.download-close').addEventListener('click',()=>downloadModal.close());
downloadModal.addEventListener('click',event=>{if(event.target!==downloadModal)return;const r=downloadModal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)downloadModal.close()});
downloadModal.addEventListener('close',()=>{
  downloadRequestEpoch++;downloadController?.abort();downloadController=null;setDownloadBusy(false);
  downloadForm.reset();downloadPlatform.removeAttribute('aria-invalid');$('#download-platform-error').hidden=true;$('#download-macos-note').hidden=true;clearDownloadErrors();downloadForm.hidden=false;downloadSuccess.hidden=true;
  downloadReturnFocus?.focus({preventScroll:true});
});
for(const[key,input]of Object.entries(downloadInputs))input.addEventListener('input',()=>{input.removeAttribute('aria-invalid');$(`#download-${key}-error`).hidden=true});
downloadPlatform.addEventListener('change',()=>{downloadPlatform.removeAttribute('aria-invalid');$('#download-platform-error').hidden=true});
downloadForm.addEventListener('submit',async event=>{
  event.preventDefault();if(downloadBusy)return;
  const fields=validateDownloadFields();if(Object.keys(fields).length){showDownloadErrors(fields);return}
  clearDownloadErrors();setDownloadBusy(true);
  const epoch=++downloadRequestEpoch,controller=new AbortController();downloadController=controller;
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const response=await fetch('/api/download',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({name:downloadInputs.name.value.trim(),whatsapp:downloadInputs.whatsapp.value.trim(),email:downloadInputs.email.value.trim(),platform:downloadPlatform.value,source:'landing',website:$('#download-website').value}),signal:controller.signal});
    const data=await response.json();if(epoch!==downloadRequestEpoch||!downloadModal.open)return;
    if(!response.ok||data.ok!==true){
      setDownloadBusy(false);showDownloadErrors(data.fields&&typeof data.fields==='object'?data.fields:{},typeof data.error==='string'&&data.error.length<=250?data.error:'Não foi possível registrar seu download. Tente novamente.');return;
    }
    const platform=downloadPlatform.value;
    if(typeof data.downloadUrl!=='string'||data.downloadUrl!==officialInstallers[platform])throw new Error('Invalid download destination');
    const labels={windows:'Windows x64','macos-arm64':'macOS · Apple Silicon','macos-x64':'macOS · Intel'};
    downloadReady.href=data.downloadUrl;$('#download-ready-meta').textContent='CutRoom 0.6.1 · '+labels[platform];
    $('#download-macos-note').hidden=platform==='windows';downloadForm.reset();downloadPlatform.value='';downloadForm.hidden=true;downloadSuccess.hidden=false;
    downloadReady.focus();downloadReady.click();
  }catch(error){
    if(epoch!==downloadRequestEpoch||!downloadModal.open)return;
    setDownloadBusy(false);showDownloadErrors({},error?.name==='AbortError'?'A conexão demorou mais que o esperado. Tente novamente.':'Não foi possível registrar seu download. Tente novamente.');
  }finally{
    clearTimeout(timeout);if(epoch===downloadRequestEpoch){downloadController=null;setDownloadBusy(false)}
  }
});
