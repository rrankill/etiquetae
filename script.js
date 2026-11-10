/* Etiquetaê — cadastro, persistência local e relatórios */
const DB_NAME='EtiquetaeDB';
/* Persistência nativa: não depende de bibliotecas externas para cadastrar. */
const db=(function(){
  let dbPromise;
  const fallbackKey='etiquetae_products_v1';
  const readFallback=()=>{try{return JSON.parse(localStorage.getItem(fallbackKey)||'[]')}catch(_){return []}};
  const writeFallback=rows=>localStorage.setItem(fallbackKey,JSON.stringify(rows));
  function open(){
    if(!('indexedDB' in window))return Promise.reject(new Error('IndexedDB indisponível'));
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('products'))d.createObjectStore('products',{keyPath:'id'});};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Falha ao abrir o banco de dados'));
      req.onblocked=()=>reject(new Error('O banco de dados está ocupado. Feche outras abas do Etiquetaê e tente novamente.'));
    });
    return dbPromise;
  }
  async function run(mode,operation){
    const d=await open();
    return await new Promise((resolve,reject)=>{
      const tx=d.transaction('products',mode),store=tx.objectStore('products');
      let result;
      try{result=operation(store,resolve,reject)}catch(err){reject(err);return}
      tx.onerror=()=>reject(tx.error||new Error('Falha ao salvar no navegador'));
      tx.onabort=()=>reject(tx.error||new Error('Operação cancelada'));
      if(result&&typeof result.onsuccess!=='undefined'){
        result.onsuccess=()=>resolve(result.result);
        result.onerror=()=>reject(result.error||new Error('Falha na operação'));
      }
    });
  }
  return {products:{
    async toArray(){
      try{return await run('readonly',s=>s.getAll())}
      catch(_){return readFallback()}
    },
    async add(item){
      try{return await run('readwrite',s=>s.add(item))}
      catch(err){const rows=readFallback();if(rows.some(p=>p.id===item.id))throw err;rows.push(item);writeFallback(rows);return item.id}
    },
    async update(id,changes){
      try{
        const d=await open();
        return await new Promise((resolve,reject)=>{
          const tx=d.transaction('products','readwrite'),s=tx.objectStore('products'),get=s.get(id);
          get.onsuccess=()=>{if(!get.result){resolve(0);return;}s.put({...get.result,...changes});};
          get.onerror=()=>reject(get.error);
          tx.oncomplete=()=>resolve(1);tx.onerror=()=>reject(tx.error);
        });
      }catch(err){const rows=readFallback(),i=rows.findIndex(p=>p.id===id);if(i<0)throw err;rows[i]={...rows[i],...changes};writeFallback(rows);return 1}
    },
    async delete(id){
      try{return await run('readwrite',s=>s.delete(id))}
      catch(_){const rows=readFallback().filter(p=>p.id!==id);writeFallback(rows);return 1}
    },
    async clear(){
      try{return await run('readwrite',s=>s.clear())}
      catch(_){writeFallback([]);return 1}
    }
  }};
})();
const CATEGORIES={
  roupas:{label:'Roupas',icon:'shirt',groups:{
    Masculino:['Moda Praia','Cueca','Calça','Camisas Sociais','Básico','Jovem','Adulto','Body Work','Acessórios do Masculino'],
    Feminino:['Moda Praia','Moda Íntima','Calça','Básico','Jovem','Adulto','Body Work','Acessórios do Feminino'],
    Infantil:['Menino','Menina','Moda Praia','Acessórios do Infantil']}},
  calcados:{label:'Calçados',icon:'footprints',groups:{
    Masculino:['Masculino'],Feminino:['Feminino'],Infantil:['Infantil']}},
  casa:{label:'Moda Casa',icon:'lamp',groups:{
    Decoração:['Decoração'],Mesa:['Mesa'],Banho:['Banho']}}
};
const SIZE={
  'Masculino':[['PP','001'],['P','002'],['M','003'],['G','004'],['GG','005'],['XG','006'],['XXG','007']],
  'Feminino':[['PP','001'],['P','002'],['M','003'],['G','004'],['GG','005']],
  'Cueca':[['P','001'],['M','002'],['G','003'],['GG','004']],
  'Camisas':[['1','001'],['2','002'],['3','003'],['4','004'],['5','005'],['6','006'],['7','007']],
  'Calças masculinas':['36','38','40','42','44','46','48','50'].map((x,i)=>[x,String(i+1).padStart(3,'0')]),
  'Calças femininas':['34','36','38','40','42','44','46','48'].map((x,i)=>[x,String(i+1).padStart(3,'0')]),
  'Infantil':['RN','P','M','G','1','2','3','4','6','8','10','12','14'].map((x,i)=>[x,String(i+1).padStart(3,'0')]),
  'Calçados masculinos':Array.from({length:10},(_,i)=>[String(i+37),String(i+1).padStart(3,'0')]),
  'Calçados femininos':Array.from({length:10},(_,i)=>[String(i+33),String(i+1).padStart(3,'0')]),
  'Calçados infantis':Array.from({length:17},(_,i)=>[String(i+20),String(i+1).padStart(3,'0')])
};
let products=[],state={page:'inicio',category:'roupas',group:'Masculino',subcategory:'Cueca',size:'P',search:'',editing:null};
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOGIN_KEY='etiquetae_authenticated_v2';
const ACCOUNTS_KEY='etiquetae_accounts_v1';
const THEME_KEY='etiquetae_theme_v1';
const PROFILE_KEY='etiquetae_employee_profile_v1';
const PASSWORD_ITERATIONS=150000;
let authMode='login';
let isAuthenticated=false;
try{isAuthenticated=localStorage.getItem(LOGIN_KEY)==='true'}catch(err){console.warn('Não foi possível restaurar a sessão:',err)}
function setTheme(theme,persist=true){
 const isDark=theme==='dark';
 document.documentElement.dataset.theme=isDark?'dark':'light';
 const button=$('#themeToggle');
 button.setAttribute('aria-label',isDark?'Ativar tema claro':'Ativar tema escuro');
 button.title=isDark?'Ativar tema claro':'Ativar tema escuro';
 document.querySelectorAll('[data-theme-choice]').forEach(option=>{
  const selected=option.dataset.themeChoice===(isDark?'dark':'light');
  option.classList.toggle('selected',selected);
  option.setAttribute('aria-pressed',String(selected));
 });
 if(persist){
  try{localStorage.setItem(THEME_KEY,isDark?'dark':'light')}
  catch(err){console.warn('Não foi possível salvar a preferência de tema:',err)}
 }
}
try{setTheme(localStorage.getItem(THEME_KEY)==='dark'?'dark':'light',false)}
catch(err){console.warn('Não foi possível carregar a preferência de tema:',err);setTheme('light',false)}
const total=arr=>arr.reduce((n,p)=>n+Number(p.quantity||0),0);
const catLabel=k=>CATEGORIES[k]?.label||k;
const toast=(msg,error=false)=>{const t=$('#toast');t.textContent=msg;t.className=error?'show error':'show';clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.className='',2800)};
const icon=(name)=>`<i data-lucide="${name}"></i>`;
function refreshIcons(){if(window.lucide)lucide.createIcons();}
function setAuthenticated(value){
 isAuthenticated=value;
 $('#loginScreen').hidden=value;
 document.querySelector('.mobile-top').hidden=!value;
 document.querySelector('.shell').hidden=!value;
 if(!value)closeAccountPanel();
}
function setAuthMode(mode){
 authMode=mode;
 const registering=mode==='register';
 $('#authEyebrow').textContent=registering?'NOVA CONTA':'BEM-VINDO(A) DE VOLTA';
 $('#loginTitle').textContent=registering?'Crie seu usuário':'Acesse seus registros';
 $('#authIntro').textContent=registering?'Cadastre seu e-mail e crie uma senha para acessar a página.':'Entre com seus dados para continuar organizando seus produtos.';
 $('#loginPassword').autocomplete=registering?'new-password':'current-password';
 $('#confirmPasswordField').hidden=!registering;
 $('#confirmPassword').disabled=!registering;
 $('#confirmPassword').required=registering;
 $('#authSubmit').textContent=registering?'Criar usuário':'Entrar';
 $('#authSwitch').textContent=registering?'Já tenho um usuário':'Criar novo usuário';
 $('#authError').hidden=true;
 $('#authError').textContent='';
}
function getAccounts(){
 const raw=localStorage.getItem(ACCOUNTS_KEY);
 if(!raw)return [];
 const accounts=JSON.parse(raw);
 if(!Array.isArray(accounts))throw new Error('Os dados das contas estão inválidos neste navegador.');
 return accounts;
}
async function passwordHash(password,salt){
 if(!window.crypto?.subtle||!window.crypto?.getRandomValues)throw new Error('Este navegador não oferece armazenamento seguro de senha. Abra o site em uma conexão HTTPS atualizada.');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:PASSWORD_ITERATIONS},key,256);
 return Array.from(new Uint8Array(bits),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function bytesToHex(bytes){return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('')}
function hexToBytes(hex){
 if(typeof hex!=='string'||!/^(?:[0-9a-f]{2})+$/i.test(hex))throw new Error('Os dados da conta estão inválidos neste navegador.');
 return Uint8Array.from(hex.match(/.{2}/g),byte=>parseInt(byte,16));
}
function showAuthError(message){
 const error=$('#authError');
 error.textContent=message;
 error.hidden=false;
}
function startAuthenticatedSession(){
 localStorage.setItem(LOGIN_KEY,'true');
 setAuthenticated(true);
 render();
}
async function load(){products=await db.products.toArray();}
function allGroups(){return Object.entries(CATEGORIES).flatMap(([cat,c])=>Object.entries(c.groups).flatMap(([group,subs])=>subs.map(sub=>({cat,group,sub}))));}
function sizeOptions(cat,group,sub){
  if(cat==='calcados')return SIZE[group==='Masculino'?'Calçados masculinos':group==='Feminino'?'Calçados femininos':'Calçados infantis'];
  if(cat==='roupas'&&group==='Infantil')return SIZE.Infantil;
  if(sub==='Cueca')return SIZE.Cueca;
  if(sub==='Camisas Sociais')return SIZE.Camisas;
  if(sub.toLowerCase().includes('calça'))return SIZE[group==='Masculino'?'Calças masculinas':'Calças femininas'];
  if(group==='Masculino'||group==='Feminino')return SIZE[group];
  return null;
}
function usesSize(cat,group,sub){return !!sizeOptions(cat,group,sub);}
function codeInfo(cat,group,sub,base,size){
  const sizes=sizeOptions(cat,group,sub);
  if(sizes){const found=sizes.find(x=>x[0]===size);if(!found)return {error:'Selecione um tamanho válido.'};if(!/^\d{8}$/.test(base))return {error:'O código-base deve ter exatamente 8 dígitos.'};return {baseCode:base,size, sizeId:found[1],fullCode:base+found[1]};}
  if(!/^\d{12}$/.test(base))return {error:'O código deve ter exatamente 12 dígitos.'};
  return {baseCode:base,size:'',sizeId:'',fullCode:base};
}
function head(title,subtitle,crumb='ETIQUETAÊ'){return `<header class="page-head"><div><div class="eyebrow">${crumb}</div><h1>${title}</h1><p class="sub">${subtitle}</p></div></header>`;}
function dashboard(){
 return productPage('roupas','Masculino','Básico',true);
}
function stat(label,value,ico){return `<article class="stat"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon(ico)}</span></div><strong>${Number(value).toLocaleString('pt-BR')}</strong></article>`;}
function categoryPage(cat){
 const c=CATEGORIES[cat];if(!c)return dashboard();
 return `${head(c.label,'Selecione um grupo para visualizar as subcategorias e cadastrar produtos.')}<div class="group-grid">${Object.entries(c.groups).map(([g,subs])=>{const count=products.filter(p=>p.category===cat&&p.group===g).length;return `<a class="group-card" href="#grupo/${cat}/${encodeURIComponent(g)}"><span class="group-icon">${icon(g==='Masculino'?'user-round':g==='Feminino'?'heart':g==='Infantil'?'baby':g==='Decoração'?'lamp':g==='Mesa'?'utensils':g==='Banho'?'bath':'layers')}</span><span class="group-card-copy"><strong>${g}</strong><small>${subs.length} subcategorias · ${count} registros</small></span><span class="card-arrow">${icon('arrow-up-right')}</span></a>`}).join('')}</div>`;
}
function subIcon(sub){
 const s=sub.toLowerCase();
 if(s.includes('calça'))return 'panels-top-left';
 if(s.includes('camisa'))return 'shirt';
 if(s.includes('cueca')||s.includes('íntima'))return 'heart';
 if(s.includes('praia'))return 'sun';
 if(s.includes('acess'))return 'sparkles';
 if(s.includes('básico'))return 'layers';
 if(s.includes('jovem'))return 'zap';
 if(s.includes('adulto'))return 'user-round';
 if(s.includes('body'))return 'briefcase-business';
 if(s.includes('menino'))return 'toy-brick';
 if(s.includes('menina'))return 'flower-2';
 if(s.includes('decoração'))return 'lamp';
 if(s.includes('mesa'))return 'utensils';
 if(s.includes('banho'))return 'bath';
 return 'package';
}
function groupPage(cat,group){
 const subs=CATEGORIES[cat]?.groups[group];if(!subs)return categoryPage(cat);
 return `${head(group,'Escolha uma subcategoria para consultar ou cadastrar produtos.',catLabel(cat).toUpperCase())}<div class="group-grid">${subs.map(sub=>{const count=products.filter(p=>p.category===cat&&p.group===group&&p.subcategory===sub).length;return `<a class="group-card" href="#cadastro/${cat}/${encodeURIComponent(group)}/${encodeURIComponent(sub)}"><span class="group-icon">${icon(subIcon(sub))}</span><span class="group-card-copy"><strong>${sub}</strong><small>${count} registros · ${total(products.filter(p=>p.category===cat&&p.group===group&&p.subcategory===sub))} peças</small></span><span class="card-arrow">${icon('arrow-up-right')}</span></a>`}).join('')}</div>`;
}
function tableMarkup(rows,actions=true){
 if(!rows.length)return '<div class="empty">Nenhum registro encontrado.</div>';
 return `<div class="table-wrap"><table><thead><tr><th>Categoria</th><th>Grupo</th><th>Subcategoria</th><th>Código principal</th><th>Tamanho</th><th>Identificador</th><th>Código completo</th><th>Quantidade</th>${actions?'<th>Ações</th>':''}</tr></thead><tbody>${rows.map(p=>`<tr><td>${catLabel(p.category)}</td><td>${esc(p.group)}</td><td>${esc(p.subcategory)}</td><td class="code">${esc(p.baseCode)}</td><td>${esc(p.size||'—')}</td><td>${esc(p.sizeId||'—')}</td><td class="code">${esc(p.fullCode)}</td><td>${p.quantity}</td>${actions?`<td><button class="icon-btn" data-action="edit" data-id="${p.id}" title="Editar">${icon('pencil')}</button><button class="icon-btn delete" data-action="delete" data-id="${p.id}" title="Excluir">${icon('trash-2')}</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function productPage(cat,group,sub,isHome=false){
 state.category=cat;state.group=group;state.subcategory=sub;
 const sizes=sizeOptions(cat,group,sub),withSize=!!sizes;
 const matches=products.filter(p=>p.category===cat&&p.group===group&&p.subcategory===sub&&(!state.search||[p.fullCode,p.baseCode,p.size].join(' ').toLowerCase().includes(state.search.toLowerCase()))).sort((a,b)=>b.createdAt-a.createdAt);
 const selected=state.editing?products.find(p=>p.id===state.editing):null;
 const activeSize=selected?.size || (sizes?.some(([label])=>label===state.selectedSize)?state.selectedSize:null) || (sizes?.some(([label])=>label===state.size)?state.size:null) || sizes?.[0]?.[0] || '';
 if(sizes)state.selectedSize=activeSize;
 return `${isHome?'':head(sub,'Cadastre e gerencie os códigos desta subcategoria.',`${catLabel(cat).toUpperCase()} / ${group.toUpperCase()}`)}
 ${isHome?`<section class="hero"><div class="hero-content"><span class="eyebrow"><span class="hero-spark">${icon('sparkles')}</span> GESTÃO INTELIGENTE</span><h2>Seu estoque, em destaque.</h2><p>Organize produtos, códigos e quantidades com tudo à mão para acompanhar cada detalhe.</p><span class="hero-note">${icon('database')} ${products.length} ${products.length===1?'produto registrado':'produtos registrados'} neste dispositivo</span></div><div class="hero-art" aria-hidden="true"><div class="hero-ring"></div><span class="hero-tag">${icon('tag')}</span><span class="hero-shirt">${icon('shirt')}</span><span class="hero-check">${icon('check')}</span></div></section>`:''}
 <section class="panel"><h2>${selected?'Editar produto':'Adicionar produto'}</h2><div class="form-grid">
 <div class="field"><label for="baseCode">${withSize?'CÓDIGO-BASE (8 DÍGITOS)':'CÓDIGO DO PRODUTO (12 DÍGITOS)'}</label><div class="scan-input-row"><input id="baseCode" inputmode="numeric" maxlength="${withSize?8:12}" placeholder="${withSize?'00000000':'000000000000'}" value="${esc(selected?.baseCode||'')}"><button class="btn scan-launch" type="button" data-action="start-scanner">${icon('scan-line')} <span>Ler números</span></button></div></div>
 ${withSize?`<div class="field"><label>TAMANHO</label><div class="size-list">${sizes.map(([label,id])=>`<button type="button" class="size-btn ${activeSize===label?'selected':''}" data-size="${esc(label)}">${esc(label)}<small>${id}</small></button>`).join('')}</div></div>`:''}
 <div class="field"><label for="quantity">QUANTIDADE</label><input id="quantity" type="number" min="1" step="1" value="${selected?.quantity||1}"></div>
 <div class="field full"><label>PRÉVIA DO CÓDIGO COMPLETO</label><div class="preview" id="codePreview">—</div></div></div>
 <div class="btn-row"><button class="btn" data-action="${selected?'save-edit':'add'}">${icon(selected?'save':'plus')} ${selected?'Salvar alterações':'Adicionar produto'}</button>${selected?'<button class="btn secondary" data-action="cancel-edit">Cancelar</button>':''}</div>
 <p class="hint">Os códigos são armazenados como texto para preservar zeros à esquerda.</p></section>
 <section class="panel"><div class="toolbar"><div><h2 style="margin:0">Produtos registrados</h2><span class="hint">${matches.length} registros · ${total(matches)} peças</span></div><input class="search-input" id="productSearch" type="search" placeholder="Buscar código ou tamanho..." value="${esc(state.search)}"></div><div id="productTable">${tableMarkup(matches)}</div></section>`;
}
function reports(){
 const rows=filteredReport();
 return `${head('Relatórios','Filtre, confira e exporte seus registros em diferentes formatos.')}
 <section class="panel"><h2>Filtros do relatório</h2><div class="filter-row">
 <div class="field"><label>CATEGORIA</label><select id="filterCategory"><option value="">Todas</option>${Object.entries(CATEGORIES).map(([k,c])=>`<option value="${k}">${c.label}</option>`).join('')}</select></div>
 <div class="field"><label>GRUPO</label><select id="filterGroup"><option value="">Todos</option>${[...new Set(allGroups().map(x=>x.group))].map(g=>`<option>${g}</option>`).join('')}</select></div>
 <div class="field"><label>SUBCATEGORIA</label><select id="filterSub"><option value="">Todas</option>${[...new Set(allGroups().map(x=>x.sub))].map(s=>`<option>${s}</option>`).join('')}</select></div>
 </div><div class="btn-row"><button class="btn" data-action="export" data-format="csv">${icon('file-down')} CSV</button><button class="btn" data-action="export" data-format="xlsx">${icon('file-spreadsheet')} Excel (XLSX)</button><button class="btn" data-action="export" data-format="pdf">${icon('file-text')} PDF</button><button class="btn secondary" data-action="export" data-format="json">${icon('database')} Backup JSON</button></div></section>
 <section class="panel"><div class="toolbar"><h2 style="margin:0">Prévia dos registros</h2><span class="hint" id="reportCount">${rows.length} registros · ${total(rows)} peças</span></div><div id="reportTable">${tableMarkup(rows,false)}</div></section>
 <section class="panel danger-zone"><h2>Zona de segurança</h2><p class="sub">A ação abaixo apaga todos os produtos salvos neste dispositivo. Essa operação não pode ser desfeita.</p><div class="btn-row"><button class="btn danger" data-action="clear-all">${icon('trash-2')} Limpar tudo</button></div></section>
 <p class="hint">Os dados permanecem apenas neste navegador/dispositivo. Para transferi-los, gere um backup JSON ou exporte uma planilha.</p>`;
}
function filteredReport(){return products.filter(p=>(!$('#filterCategory')?.value||p.category===$('#filterCategory').value)&&(!$('#filterGroup')?.value||p.group===$('#filterGroup').value)&&(!$('#filterSub')?.value||p.subcategory===$('#filterSub').value));}
function render(){
 if(!isAuthenticated)return;
 const hash=decodeURIComponent(location.hash.slice(1)||'inicio').split('/');
 let html;
 if(hash[0]==='grupo')html=groupPage(hash[1],hash[2]);
 else if(hash[0]==='cadastro')html=productPage(hash[1],hash[2],hash[3]);
 else if(hash[0]==='relatorios')html=reports();
 else if(CATEGORIES[hash[0]])html=categoryPage(hash[0]);
 else html=dashboard();
 $('#app').innerHTML=html;
 document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.dataset.page===(hash[0]==='grupo'||hash[0]==='cadastro'?hash[1]:hash[0])));
 $('#mobileBack').hidden=hash.length===1&&hash[0]==='inicio';
 refreshIcons();updatePreview();
}
function closeMobileMenu(){
 $('#sidebar').classList.remove('open');
 $('#sidebar').classList.remove('navigation-open');
 $('#sidebarBackdrop').hidden=true;
 $('#menuToggle').setAttribute('aria-expanded','false');
 $('#desktopMenuToggle').setAttribute('aria-expanded','false');
 $('#desktopMenuToggle').setAttribute('aria-label','Abrir menu');
}
function openMobileMenu(){
 $('#sidebar').classList.add('open');
 $('#sidebarBackdrop').hidden=false;
 $('#menuToggle').setAttribute('aria-expanded','true');
}
function setAccountTab(tab){
 const isProfile=tab==='profile';
 $('#profileTab').setAttribute('aria-selected',String(isProfile));
 $('#guideTab').setAttribute('aria-selected',String(!isProfile));
 $('#profileSection').hidden=!isProfile;
 $('#guideSection').hidden=isProfile;
}
function openAccountPanel(tab='profile'){
 closeMobileMenu();
 setAccountTab(tab);
 $('#accountPanel').hidden=false;
 $('#accountBackdrop').hidden=false;
 $('#accountPanel').setAttribute('aria-hidden','false');
 refreshIcons();
 (tab==='profile'?$('#profileName'):$('#guideTab')).focus();
}
function closeAccountPanel(){
 const panel=$('#accountPanel');
 if(!panel)return;
 const wasOpen=!panel.hidden;
 panel.hidden=true;
 $('#accountBackdrop').hidden=true;
 panel.setAttribute('aria-hidden','true');
 if(wasOpen&&isAuthenticated){
  const returnTarget=window.matchMedia('(max-width: 900px)').matches?$('#menuToggle'):$('#desktopMenuToggle');
  returnTarget.focus();
 }
}
function loadEmployeeProfile(){
 try{
  const stored=localStorage.getItem(PROFILE_KEY);
  const profile=stored?JSON.parse(stored):{};
  if(!profile||typeof profile!=='object'||Array.isArray(profile))throw new Error('Os dados do perfil estão inválidos.');
  ['name','role','department','email','phone','employeeId'].forEach(key=>{
   const field=$(`#profile${key[0].toUpperCase()+key.slice(1)}`);
   field.value=typeof profile[key]==='string'?profile[key]:'';
  });
 }catch(err){
  console.warn('Não foi possível carregar o perfil do funcionário:',err);
  toast('Não foi possível carregar os dados do perfil.',true);
 }
}
function goBackToParentPage(){
 const hash=decodeURIComponent(location.hash.slice(1)||'inicio').split('/');
 let parent;
 if(hash[0]==='cadastro')parent=`#grupo/${encodeURIComponent(hash[1])}/${encodeURIComponent(hash[2])}`;
 else if(hash[0]==='grupo')parent=`#${encodeURIComponent(hash[1])}`;
 else if(hash[0]!=='inicio')parent='#inicio';
 if(parent)location.hash=parent;
}
function updatePreview(){
 const input=$('#baseCode');if(!input)return;
 const base=input.value.replace(/\D/g,'');const sizes=sizeOptions(state.category,state.group,state.subcategory);
 const size=(sizes?.some(([label])=>label===state.selectedSize)?state.selectedSize:null)||(sizes?.some(([label])=>label===state.size)?state.size:null)||sizes?.[0]?.[0];const found=sizes?.find(x=>x[0]===size);
 $('#codePreview').textContent=base?(sizes?(base.padEnd(8,'·')+(found?.[1]||'???')):base.padEnd(12,'·')):'—';
}
function showModal(title,body,confirmText='Confirmar'){
 return new Promise(resolve=>{const d=$('#modal');d.innerHTML=`<h2 style="font:800 19px Manrope;margin:0 0 8px">${title}</h2><div class="modal-copy">${body}</div><div class="modal-actions"><button class="btn secondary" data-choice="no">Cancelar</button><button class="btn danger" data-choice="yes">${confirmText}</button></div>`;d.showModal();d.onclick=e=>{const b=e.target.closest('[data-choice]');if(b){d.close();resolve(b.dataset.choice==='yes')}};d.oncancel=()=>resolve(false);});
}
function getForm(){
 const base=$('#baseCode')?.value.trim()||'',qty=Number($('#quantity')?.value||1),sizes=sizeOptions(state.category,state.group,state.subcategory);
 if(!Number.isInteger(qty)||qty<1)return {error:'A quantidade deve ser um número inteiro maior que zero.'};
 const chosenSize=(sizes?.some(([label])=>label===state.selectedSize)?state.selectedSize:null)||(sizes?.some(([label])=>label===state.size)?state.size:null)||sizes?.[0]?.[0];
 const info=codeInfo(state.category,state.group,state.subcategory,base,chosenSize);
 if(info.error)return info;
 return {...info,quantity:qty,category:state.category,group:state.group,subcategory:state.subcategory};
}
async function addProduct(){
 try{
 const data=getForm();if(data.error)return toast(data.error,true);
 const duplicate=products.find(p=>p.category===data.category&&p.group===data.group&&p.subcategory===data.subcategory&&p.fullCode===data.fullCode);
 if(duplicate){const yes=await showModal('Produto já cadastrado',`O código <b>${esc(data.fullCode)}</b> já existe com ${duplicate.quantity} unidade(s). Deseja somar ${data.quantity} à quantidade existente?`,'Somar quantidade');if(!yes)return;await db.products.update(duplicate.id,{quantity:duplicate.quantity+data.quantity});}
 else await db.products.add({id:(window.crypto&&typeof window.crypto.randomUUID==='function')?window.crypto.randomUUID():(String(Date.now())+'-'+Math.random().toString(16).slice(2)),...data,createdAt:Date.now()});
 await load();state.selectedSize=undefined;render();toast(duplicate?'Quantidade atualizada!':'Código registrado com sucesso!');
 }catch(err){console.error(err);toast('Não foi possível registrar. Verifique o armazenamento do navegador e tente novamente.',true);}
}
async function saveEdit(){
 try{
 const data=getForm();if(data.error)return toast(data.error,true);
 const id=state.editing;const duplicate=products.find(p=>p.id!==id&&p.category===data.category&&p.group===data.group&&p.subcategory===data.subcategory&&p.fullCode===data.fullCode);
 if(duplicate)return toast('Este código já existe nesta subcategoria. Edite o registro existente.',true);
 await db.products.update(id,data);state.editing=null;await load();render();toast('Produto atualizado!');
 }catch(err){console.error(err);toast('Não foi possível atualizar o registro.',true);}
}
async function deleteProduct(id){
 const p=products.find(x=>String(x.id)===String(id));if(!p)return;
 if(await showModal('Excluir produto?',`O código <b>${esc(p.fullCode)}</b> e sua quantidade (${p.quantity}) serão removidos.`,'Excluir')){await db.products.delete(p.id);await load();render();toast('Produto excluído.');}
}
async function clearAll(){
 if(!products.length)return toast('Não há registros para limpar.');
 const ok=await showModal('Limpar todos os dados?',`Você está prestes a excluir <b>${products.length} registros</b>, totalizando <b>${total(products)} peças</b>. Esta ação é permanente. Recomendamos exportar um backup antes.`,'Sim, limpar tudo');
 if(!ok)return;await db.products.clear();products=[];state.editing=null;state.search='';render();toast('Todos os registros foram apagados.');
}
function exportRows(rows){return rows.map(p=>({'Categoria':catLabel(p.category),'Grupo':p.group,'Subcategoria':p.subcategory,'Código principal':p.baseCode,'Tamanho':p.size||'','Identificador':p.sizeId||'','Código completo':p.fullCode,'Quantidade':p.quantity}));}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);}
function exportFile(format){
 const rows=filteredReport(),data=exportRows(rows);if(!rows.length)return toast('Não há registros para exportar.',true);
 const date=new Date().toLocaleString('pt-BR'),stem='etiquetae-'+new Date().toISOString().slice(0,10);
 if(format==='json'){download(new Blob([JSON.stringify({app:'Etiquetaê',generatedAt:date,products:rows},null,2)],{type:'application/json'}),stem+'-backup.json');return;}
 if(format==='csv'){const keys=Object.keys(data[0]);const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const csv=['Relatório Etiquetaê',`Gerado em: ${date}`,keys.map(cell).join(';'),...data.map(r=>keys.map(k=>cell(r[k])).join(';'))].join('\r\n');download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),stem+'.csv');return;}
 if(format==='xlsx'){if(!window.XLSX)return toast('Biblioteca Excel indisponível. Verifique sua conexão.',true);const ws=XLSX.utils.json_to_sheet([{'Relatório':'Etiquetaê','Gerado em':date},...data]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Produtos');XLSX.writeFile(wb,stem+'.xlsx');return;}
 if(format==='pdf'){if(!window.jspdf?.jsPDF)return toast('Biblioteca PDF indisponível. Verifique sua conexão.',true);const doc=new jspdf.jsPDF({orientation:'landscape'});doc.setFontSize(16);doc.text('Relatório Etiquetaê',14,15);doc.setFontSize(9);doc.text(`Gerado em: ${date} · ${rows.length} registros · ${total(rows)} peças`,14,22);doc.autoTable({startY:29,head:[Object.keys(data[0])],body:data.map(r=>Object.values(r).map(String)),styles:{fontSize:7},headStyles:{fillColor:[16,59,53]}});doc.save(stem+'.pdf');}
}
$('#navigation').addEventListener('click',closeMobileMenu);
$('#mobileBack').addEventListener('click',goBackToParentPage);
$('#menuToggle').addEventListener('click',()=>{
 const isOpen=$('#sidebar').classList.toggle('open');
 $('#sidebarBackdrop').hidden=!isOpen;
 $('#menuToggle').setAttribute('aria-expanded',String(isOpen));
});
$('#desktopMenuToggle').addEventListener('click',()=>{
 const isOpen=$('#sidebar').classList.toggle('navigation-open');
 $('#sidebarBackdrop').hidden=!isOpen;
 $('#desktopMenuToggle').setAttribute('aria-expanded',String(isOpen));
 $('#desktopMenuToggle').setAttribute('aria-label',isOpen?'Fechar menu':'Abrir menu');
});
$('#sidebarBackdrop').addEventListener('click',closeMobileMenu);
$('#accountPanelClose').addEventListener('click',closeAccountPanel);
$('#accountBackdrop').addEventListener('click',closeAccountPanel);
$('#profileTab').addEventListener('click',()=>setAccountTab('profile'));
$('#guideTab').addEventListener('click',()=>setAccountTab('guide'));
document.querySelectorAll('[data-theme-choice]').forEach(option=>option.addEventListener('click',()=>{
 setTheme(option.dataset.themeChoice);
}));
$('#profileForm').addEventListener('submit',e=>{
 e.preventDefault();
 const profile={
  name:$('#profileName').value.trim(),
  role:$('#profileRole').value.trim(),
  department:$('#profileDepartment').value.trim(),
  email:$('#profileEmail').value.trim(),
  phone:$('#profilePhone').value.trim(),
  employeeId:$('#profileEmployeeId').value.trim()
 };
 if(!profile.name||!profile.role)return toast('Informe o nome e o cargo para salvar o perfil.',true);
 try{
  localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
  toast('Perfil salvo neste dispositivo.');
 }catch(err){
  console.error('Não foi possível salvar o perfil do funcionário:',err);
  toast('Não foi possível salvar o perfil. Verifique o espaço disponível no navegador.',true);
 }
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&!$('#accountPanel').hidden)closeAccountPanel();
});
let menuSwipeStart=null;
document.addEventListener('touchstart',e=>{
 if(e.touches.length!==1||!window.matchMedia('(max-width: 900px)').matches||$('.shell').hidden){
   menuSwipeStart=null;
   return;
 }
 const touch=e.touches[0],menuOpen=$('#sidebar').classList.contains('open');
 if(menuOpen||touch.clientX<=24)menuSwipeStart={x:touch.clientX,y:touch.clientY,menuOpen};
},{passive:true});
document.addEventListener('touchend',e=>{
 if(!menuSwipeStart)return;
 const start=menuSwipeStart;
 menuSwipeStart=null;
 const touch=e.changedTouches[0],deltaX=touch.clientX-start.x,deltaY=touch.clientY-start.y;
 if(Math.abs(deltaX)<60||Math.abs(deltaX)<Math.abs(deltaY)*1.25)return;
 if(start.menuOpen&&deltaX<0)closeMobileMenu();
 else if(!start.menuOpen&&deltaX>0)openMobileMenu();
},{passive:true});
document.addEventListener('touchcancel',()=>{menuSwipeStart=null;},{passive:true});
$('#themeToggle').addEventListener('click',()=>{
 setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
});
$('#loginForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const email=$('#loginEmail').value.trim().toLowerCase();
 const password=$('#loginPassword').value;
 const submit=$('#authSubmit');
 submit.disabled=true;
 try{
   const accounts=getAccounts();
   if(authMode==='register'){
     if(password!==$('#confirmPassword').value){
       showAuthError('As senhas não conferem.');
       return;
     }
     if(accounts.some(account=>account.email===email)){
       showAuthError('Já existe um usuário com este e-mail. Entre com sua senha.');
       return;
     }
     if(!window.crypto?.getRandomValues)throw new Error('Este navegador não oferece armazenamento seguro de senha. Abra o site em uma conexão HTTPS atualizada.');
     const salt=crypto.getRandomValues(new Uint8Array(16));
     accounts.push({email,salt:bytesToHex(salt),passwordHash:await passwordHash(password,salt),iterations:PASSWORD_ITERATIONS});
     localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(accounts));
     $('#loginForm').reset();
     startAuthenticatedSession();
   }else{
     const account=accounts.find(item=>item.email===email);
     if(!account){
       showAuthError('E-mail ou senha incorretos.');
       return;
     }
     const actual=await passwordHash(password,hexToBytes(account.salt));
     if(actual!==account.passwordHash){
       showAuthError('E-mail ou senha incorretos.');
       return;
     }
     startAuthenticatedSession();
   }
 }catch(err){
   console.error('Falha ao autenticar usuário:',err);
   showAuthError(err instanceof DOMException&&err.name==='QuotaExceededError'?'Não há espaço disponível para salvar esta conta neste navegador.':err.message||'Não foi possível concluir o acesso. Tente novamente.');
 }finally{
   submit.disabled=false;
 }
});
$('#authSwitch').addEventListener('click',()=>{
 setAuthMode(authMode==='login'?'register':'login');
 $('#loginPassword').value='';
 $('#confirmPassword').value='';
});
document.addEventListener('click',async e=>{
 const size=e.target.closest('[data-size]');if(size){state.selectedSize=size.dataset.size;document.querySelectorAll('.size-btn').forEach(b=>b.classList.toggle('selected',b===size));updatePreview();return;}
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action,id=b.dataset.id;
 if(action==='toggle-password'){
   const input=$('#loginPassword'),visible=input.type==='password';
   input.type=visible?'text':'password';
   b.textContent=visible?'Ocultar':'Mostrar';
   b.setAttribute('aria-label',visible?'Ocultar senha':'Mostrar senha');
   b.setAttribute('aria-pressed',String(visible));
 }
 if(action==='open-profile')openAccountPanel('profile');
 if(action==='logout'){
   try{localStorage.removeItem(LOGIN_KEY)}catch(err){console.warn('Não foi possível encerrar a sessão:',err)}
   setAuthenticated(false);
   $('#loginForm').reset();
   setAuthMode('login');
   $('#loginPassword').type='password';
   const toggle=$('[data-action="toggle-password"]');
   toggle.textContent='Mostrar';
   toggle.setAttribute('aria-label','Mostrar senha');
   toggle.setAttribute('aria-pressed','false');
 }
 if(action==='add')await addProduct();
 if(action==='save-edit')await saveEdit();
 if(action==='cancel-edit'){state.editing=null;render();}
 if(action==='edit'){state.editing=id;const p=products.find(x=>String(x.id)===String(id));state.selectedSize=p.size;render();}
 if(action==='delete')await deleteProduct(id);
 if(action==='clear-all')await clearAll();
 if(action==='export')exportFile(b.dataset.format);
 if(action==='start-scanner')startNumberScanner();
 if(action==='stop-scanner')stopNumberScanner();
 if(action==='capture-scan')captureNumberScan();
});
$('#scannerImageInput').addEventListener('change',e=>{
 const input=e.target,file=input.files?.[0];
 input.value='';
 processUploadedImage(file);
});
document.addEventListener('input',e=>{
 if(e.target.id==='baseCode'){e.target.value=e.target.value.replace(/\D/g,'').slice(0,sizeOptions(state.category,state.group,state.subcategory)?8:12);updatePreview();}
 if(e.target.id==='productSearch'){state.search=e.target.value;const p=products.filter(x=>x.category===state.category&&x.group===state.group&&x.subcategory===state.subcategory&&(!state.search||[x.fullCode,x.baseCode,x.size].join(' ').toLowerCase().includes(state.search.toLowerCase()))).sort((a,b)=>b.createdAt-a.createdAt);$('#productTable').innerHTML=tableMarkup(p);refreshIcons();}
});
document.addEventListener('change',e=>{if(['filterCategory','filterGroup','filterSub'].includes(e.target.id)){const rows=filteredReport();$('#reportTable').innerHTML=tableMarkup(rows,false);$('#reportCount').textContent=`${rows.length} registros · ${total(rows)} peças`;refreshIcons();}});

/* Scanner OCR: lê somente sequências numéricas impressas na etiqueta. */
let scannerStream=null,scannerWorker=null,scannerWorkerPromise=null,scannerLoop=null,scannerBusy=false,scannerTorch=false,scannerImageUrl=null;
function scannerStatus(message,isError=false){
 const el=$('#scannerStatus');if(el){el.textContent=message;el.classList.toggle('error',!!isError);}
}
async function getScannerWorker(){
 if(!window.Tesseract)throw new Error('Não foi possível carregar o leitor de números. Verifique a conexão.');
 if(!scannerWorkerPromise){
   scannerWorkerPromise=Tesseract.createWorker('eng').then(worker=>{
     scannerWorker=worker;
     return worker;
   }).catch(err=>{
     scannerWorkerPromise=null;
     throw err;
   });
 }
 return scannerWorkerPromise;
}
async function startNumberScanner(){
 const dlg=$('#scannerDialog');
 if(!dlg)return toast('Scanner indisponível nesta versão.',true);
 dlg.showModal();
 resetScannerImage();
 if(!window.isSecureContext || !navigator.mediaDevices?.getUserMedia){
   scannerStatus('A câmera exige HTTPS ou não é compatível com este navegador. Você pode enviar uma imagem.',true);
   return;
 }
 try{
   scannerStatus('Solicitando acesso à câmera…');
   scannerStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
   const video=$('#scannerVideo');video.srcObject=scannerStream;await video.play();
   scannerStatus('Câmera ativa. Centralize os números da etiqueta.');
   scannerStatus('Preparando reconhecimento de números…');
   await getScannerWorker();
   scannerStatus('Pronto! Mantenha os números nítidos dentro da área de leitura.');
   scannerLoop=setInterval(scanVideoFrame,1100);
 }catch(err){
   console.error('Scanner:',err);
   scannerStatus(err.name==='NotAllowedError'?'Permita o acesso à câmera nas configurações do navegador ou envie uma imagem.':err.name==='NotFoundError'?'Nenhuma câmera foi encontrada neste aparelho. Envie uma imagem da galeria ou dos arquivos.':'Não foi possível iniciar a câmera. Você também pode enviar uma imagem.',true);
   if(scannerStream){scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null;}
 }
}
async function processUploadedImage(file){
 if(!file)return;
 if(!file.type.startsWith('image/')){
   scannerStatus('Selecione um arquivo de imagem válido.',true);
   return;
 }
 if(scannerBusy){
   scannerStatus('Aguarde a leitura atual terminar antes de enviar outra imagem.',true);
   return;
 }
 scannerBusy=true;
 if(scannerLoop){clearInterval(scannerLoop);scannerLoop=null;}
 if(scannerStream){scannerStream.getTracks().forEach(track=>track.stop());scannerStream=null;}
 resetScannerImage();
 const video=$('#scannerVideo');
 if(video){video.pause();video.srcObject=null;video.hidden=true;}
 $('.scanner-frame').hidden=true;
 const image=$('#scannerImage');
 scannerImageUrl=URL.createObjectURL(file);
 image.src=scannerImageUrl;
 image.hidden=false;
 $('#scannerCandidate').textContent='—';
 $('#scannerCandidate').dataset.code='';
 $('#scannerUse').disabled=true;
 scannerStatus('Preparando leitura da imagem…');
 try{
   const worker=await getScannerWorker();
   scannerStatus('Lendo os números da imagem…');
   const result=await worker.recognize(file);
   const candidate=extractNumericCandidate(result?.data?.text||'');
   if(candidate){
     const out=$('#scannerCandidate');
     out.textContent=candidate;
     out.dataset.code=candidate;
     $('#scannerUse').disabled=false;
     scannerStatus(`Número identificado: ${candidate}. Confira antes de usar.`);
   }else{
     scannerStatus('Nenhum número legível foi encontrado. Tente outra imagem mais nítida.',true);
   }
 }catch(err){
   console.error('Leitura da imagem:',err);
   scannerStatus(err.message||'Não foi possível ler esta imagem. Tente outro arquivo.',true);
 }finally{
   scannerBusy=false;
 }
}
function resetScannerImage(){
 if(scannerImageUrl){URL.revokeObjectURL(scannerImageUrl);scannerImageUrl=null;}
 const image=$('#scannerImage');
 if(image){image.removeAttribute('src');image.hidden=true;}
 const video=$('#scannerVideo');
 if(video)video.hidden=false;
 const frame=$('.scanner-frame');
 if(frame)frame.hidden=false;
}
async function scanVideoFrame(){
 if(scannerBusy||!scannerWorker)return;
 const video=$('#scannerVideo'),canvas=$('#scannerCanvas');
 if(!video||video.readyState<2||!video.videoWidth)return;
 scannerBusy=true;
 try{
   const w=video.videoWidth,h=video.videoHeight;
   canvas.width=w;canvas.height=h;
   const ctx=canvas.getContext('2d',{willReadFrequently:true});
   ctx.drawImage(video,0,0,w,h);
   const result=await scannerWorker.recognize(canvas);
   const raw=result?.data?.text||'';
   const candidate=extractNumericCandidate(raw);
   if(candidate){
     scannerStatus(`Número identificado: ${candidate}. Toque em “Usar número” para preencher.`);
     const out=$('#scannerCandidate');out.textContent=candidate;out.dataset.code=candidate;
     $('#scannerUse').disabled=false;
   }else{
     scannerStatus('Aguardando números legíveis… aproxime e mantenha a etiqueta firme.');
   }
 }catch(err){console.warn('OCR frame:',err);}
 finally{scannerBusy=false;}
}
function extractNumericCandidate(raw){
 const lines=String(raw||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 const sizes=sizeOptions(state.category,state.group,state.subcategory);
 const candidates=[];
 for(const line of lines){
   const groups=line.match(/\d[\d\s.\-_/]{5,18}\d/g)||[];
   for(const group of groups){
     const digits=group.replace(/\D/g,'');
     if([8,11,12].includes(digits.length))candidates.push(digits);
   }
   const compact=line.replace(/\D/g,'');
   if([8,11,12].includes(compact.length))candidates.push(compact);
 }
 if(!candidates.length){
   const digits=String(raw||'').replace(/\D/g,'');
   for(const len of (sizes?[11,8,12]:[12,8,11])){
     const match=digits.match(new RegExp(`\\d{${len}}`));if(match)candidates.push(match[0]);
   }
 }
 if(!candidates.length)return '';
 candidates.sort((a,b)=>{
   const score=x=>(sizes?(x.length===11?3:x.length===8?2:x.length===12?1:0):(x.length===12?3:x.length===8?2:x.length===11?1:0));
   return score(b)-score(a);
 });
 return candidates[0]||'';
}
function applyScannedNumber(value){
 const input=$('#baseCode');if(!input)return;
 const digits=String(value||'').replace(/\D/g,'');
 const sizes=sizeOptions(state.category,state.group,state.subcategory);
 if(sizes&&digits.length===11){
   input.value=digits.slice(0,8);
   const id=digits.slice(8);
   const found=sizes.find(([,sizeId])=>sizeId===id);
   if(found){state.selectedSize=found[0];document.querySelectorAll('.size-btn').forEach(b=>b.classList.toggle('selected',b.dataset.size===found[0]));}
 }else if(digits.length===8||digits.length===12){
   input.value=digits.slice(0,sizes?8:12);
 }else{
   scannerStatus('Número reconhecido, mas o formato não corresponde a esta categoria.',true);return;
 }
 updatePreview();
 stopNumberScanner();
 toast('Número lido! Confira o código antes de registrar.');
}
async function captureNumberScan(){
 const value=$('#scannerCandidate')?.dataset.code||'';
 if(value)applyScannedNumber(value);
}
async function stopNumberScanner(){
 if(scannerLoop){clearInterval(scannerLoop);scannerLoop=null;}
 if(scannerStream){scannerStream.getTracks().forEach(t=>t.stop());scannerStream=null;}
 if(scannerWorker){try{await scannerWorker.terminate()}catch(err){console.warn('Não foi possível encerrar o leitor de números:',err)}scannerWorker=null;}
 scannerWorkerPromise=null;
 const video=$('#scannerVideo');if(video)video.srcObject=null;
 resetScannerImage();
 const imageInput=$('#scannerImageInput');if(imageInput)imageInput.value='';
 const dlg=$('#scannerDialog');if(dlg?.open)dlg.close();
 scannerBusy=false;scannerTorch=false;
 const btn=$('#scannerUse');if(btn)btn.disabled=true;
 const candidate=$('#scannerCandidate');if(candidate){candidate.textContent='—';candidate.dataset.code='';}
}

window.addEventListener('hashchange',()=>{state.editing=null;state.search='';state.selectedSize=undefined;closeMobileMenu();render();window.scrollTo(0,0);});
(async()=>{try{loadEmployeeProfile();await load();setAuthenticated(isAuthenticated);render();}catch(err){$('#app').innerHTML=`<section class="panel"><h2>Não foi possível abrir o armazenamento</h2><p>Verifique se o navegador permite armazenamento local e recarregue o aplicativo.</p></section>`;console.error(err);}})();
