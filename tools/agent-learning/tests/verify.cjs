/* 此测试执行真实状态模块和页面事件，但不代替浏览器布局检查。 */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const dataContext={};vm.createContext(dataContext);vm.runInContext(fs.readFileSync(path.join(root,'curriculum.js'),'utf8'),dataContext);
const curriculum=dataContext.AgentCurriculum;
const {KEY,createStore}=require('../progress.js');
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const memory={values:new Map(),getItem(key){return this.values.get(key)||null;},setItem(key,value){this.values.set(key,value);}};
let store=createStore(memory,curriculum);
test('六个阶段，24 个学习项，18 个项目验收项',()=>{assert.equal(curriculum.stages.length,6);assert.equal(store.stats().total,42);assert.equal(new Set(curriculum.stages.flatMap(s=>s.lessons.map(l=>l.id))).size,24);});
test('每个阶段都有目标、准备条件、讲解、可执行项目与来源',()=>{for(const s of curriculum.stages){assert.ok(s.goal&&s.prerequisite&&s.time);assert.equal(s.lessons.length,4);for(const l of s.lessons)assert.ok(l.body.length>80);assert.equal(s.project.steps.length,3);assert.equal(s.project.checks.length,3);assert.ok(s.project.template&&s.project.deliverable);for(const id of s.sources)assert.ok(curriculum.sources.some(r=>r.id===id));}});
test('真实勾选、撤销与统计',()=>{store.setDone('s1-l1',true);assert.equal(store.stats().done,1);assert.equal(store.stats().percent,2);store.setDone('s1-l1',false);assert.equal(store.stats().done,0);assert.throws(()=>store.setDone('unknown',true));});
test('阶段完成需同时完成学习和项目，下一阶段正确',()=>{for(const l of curriculum.stages[0].lessons)store.setDone(l.id,true);assert.equal(store.stageStats('s1').complete,false);for(let i=0;i<3;i++)store.setDone('s1-p'+i,true);assert.equal(store.stageStats('s1').complete,true);assert.equal(store.stats().completedStages,1);assert.equal(store.nextStage().id,'s2');});
test('刷新后恢复记录与笔记',()=>{store.setNote('s2','测试 k=10，结果为 2 3 5 7，共4个。');store.setLastStage('s2');const reloaded=createStore(memory,curriculum);assert.equal(reloaded.state.notes.s2,store.state.notes.s2);assert.equal(reloaded.state.lastStage,'s2');assert.equal(reloaded.stats().done,7);});
test('导出、重置、导入能完整往返',()=>{const backup=store.export();store.reset();assert.equal(store.stats().done,0);assert.equal(Object.keys(store.state.notes).length,0);store.import(backup);assert.equal(store.stats().done,7);assert.ok(store.state.notes.s2);});
test('错误备份不会覆盖原记录',()=>{const before=store.export();for(const raw of ['bad','{}',JSON.stringify({version:1,done:{unknown:true},notes:{}}),JSON.stringify({version:1,done:{'s1-l1':'true'},notes:{}}),JSON.stringify({version:1,done:{},notes:{s1:'x'.repeat(10001)}}),JSON.stringify({version:1,done:{},notes:{'__proto__':'bad'},lastStage:'bad'})]){assert.throws(()=>store.import(raw));assert.equal(store.export(),before);}});
test('存储被禁用时仍能学习和导出',()=>{const blocked=createStore({getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}},curriculum);assert.equal(blocked.persistent,false);assert.equal(blocked.setDone('s1-l1',true),false);assert.equal(blocked.stats().done,1);assert.ok(JSON.parse(blocked.export()).done['s1-l1']);});
test('损坏的存储保留恢复副本',()=>{const values=new Map([[KEY,'broken']]);const invalid=createStore({getItem(k){return values.get(k)||null;},setItem(k,v){values.set(k,v);}},curriculum);assert.equal(invalid.loadProblem,true);assert.equal(invalid.stats().done,0);invalid.setDone('s1-l1',true);assert.equal(values.get(KEY+'-recovery'),'broken');});
test('六份最长中文笔记可完整导出并导入',()=>{const long=createStore({getItem(){return null;},setItem(){}},curriculum);for(const s of curriculum.stages)long.setNote(s.id,'学习'.repeat(5000));const raw=long.export();assert.ok(Buffer.byteLength(raw)>150000);long.reset();long.import(raw);assert.equal(long.state.notes.s6.length,10000);});
test('全部完成与反向修改正确',()=>{const all=createStore({getItem(){return null;},setItem(){}},curriculum);for(const s of curriculum.stages){for(const l of s.lessons)all.setDone(l.id,true);for(let i=0;i<3;i++)all.setDone(s.id+'-p'+i,true);}assert.equal(all.stats().percent,100);assert.equal(all.nextStage(),null);all.setDone('s6-p2',false);assert.equal(all.nextStage().id,'s6');});

/* 轻量 DOM 测试适配器只提供应用使用的标准事件和节点接口。 */
function decode(s){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#10;/g,'\n').replace(/&amp;/g,'&');}
class Element{
  constructor(tag='div',attrs={}){this.tagName=tag.toUpperCase();this.attrs={};this.children=[];this.listeners={};this.style={setProperty:(k,v)=>{this.style[k]=v;}};this.hidden=false;this.open=false;this.value='';this.text='';this.dataset={};for(const [k,v]of Object.entries(attrs))this.setAttribute(k,v);}
  setAttribute(k,v){this.attrs[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);if(k==='open')this.open=true;if(k==='hidden')this.hidden=true;if(k==='checked')this.checked=true;if(k==='value')this.value=v;}
  getAttribute(k){return this.attrs[k]??null;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
  async dispatch(type,event={}){for(const fn of this.listeners[type]||[])await fn({target:this,...event});}
  get firstElementChild(){return this.children[0];}
  get id(){return this.attrs.id;}
  get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}
  set textContent(v){this.text=String(v);this.children=[];}
  set innerHTML(v){this.raw=String(v);this.text='';this.children=parse(this.raw).children;for(const c of this.children)c.parent=this;}
  get innerHTML(){return this.raw||'';}
  append(c){c.parent=this;this.children.push(c);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  querySelectorAll(selector){const out=[];function walk(node){for(const c of node.children){if(matches(c,selector))out.push(c);walk(c);}}walk(this);return out;}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  closest(s){let node=this;while(node){if(matches(node,s))return node;node=node.parent;}return null;}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
  click(){this.clicked=true;}
  showModal(){this.open=true;}
}
function matches(n,s){if(s.startsWith('#'))return n.id===s.slice(1);if(s.startsWith('.'))return(n.attrs.class||'').split(' ').includes(s.slice(1));const attr=s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);if(attr)return n.attrs[attr[1]]!==undefined&&(attr[2]===undefined||n.attrs[attr[1]]===attr[2]);return n.tagName===s.toUpperCase();}
function parse(html){const tree=new Element('root'),stack=[tree],voids=new Set(['meta','link','input','br','img','hr']);for(const tok of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]*>|[^<]+/g)||[]){if(tok.startsWith('<!'))continue;if(tok.startsWith('</')){const tag=tok.slice(2,-1).trim().toUpperCase();while(stack.length>1){if(stack.pop().tagName===tag)break;}continue;}if(tok.startsWith('<')){const m=tok.match(/^<([\w-]+)/);if(!m)continue;const attrs={};for(const a of tok.slice(m[0].length,-1).matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)'|=([^\s>]+))?/g))attrs[a[1]]=decode(a[2]??a[3]??a[4]??'');const el=new Element(m[1],attrs);stack.at(-1).append(el);if(!voids.has(m[1])&&!tok.endsWith('/>'))stack.push(el);}else {const text=new Element('#text');text.text=decode(tok);stack.at(-1).append(text);}}return tree;}
const tree=parse(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const document={documentElement:tree.querySelector('html'),body:tree.querySelector('body'),getElementById:id=>tree.querySelector('#'+id),querySelectorAll:s=>tree.querySelectorAll(s),createElement:tag=>new Element(tag)};
const winEvents={},fakeMemory={values:new Map(),getItem(k){return this.values.get(k)||null;},setItem(k,v){this.values.set(k,v);}};
const downloads=[],clipboard=[],window={localStorage:fakeMemory,location:{hash:''},matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener:(type,fn)=>winEvents[type]=fn,confirm:()=>true};
const sandbox={window,document,AgentCurriculum:curriculum,AgentProgress:{KEY,createStore},setTimeout:()=>1,clearTimeout(){},Blob:class{constructor(parts,options){this.parts=parts;this.type=options.type;downloads.push(this);}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},navigator:{clipboard:{writeText:async text=>clipboard.push(text)}}};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
const container=document.getElementById('view-container');
function navigate(hash){window.location.hash=hash;winEvents.hashchange();}
async function click(selector){const node=container.querySelector(selector);assert.ok(node,'selector missing: '+selector);await container.dispatch('click',{target:node});if(window.location.hash)winEvents.hashchange();}
async function runUI(){
  test('页面语义、静态资源与公开索引设置',()=>{assert.equal(document.documentElement.attrs.lang,'zh-CN');assert.ok(tree.querySelector('main'));assert.ok(tree.querySelector('nav'));assert.ok(tree.querySelector('dialog'));for(const tag of tree.querySelectorAll('script'))assert.ok(fs.existsSync(path.join(root,tag.attrs.src)));assert.ok(!tree.querySelectorAll('meta').some(m=>m.attrs.name==='robots'&&m.attrs.content.includes('noindex')));});
  test('首页实际渲染六阶段和24个学习项',()=>{assert.equal(container.querySelectorAll('.phase').length,6);assert.equal(container.querySelectorAll('[data-task]').length,24);assert.equal(document.getElementById('completed-count').textContent,'0');});
  const task=container.querySelector('#s1-l1');task.checked=true;await container.dispatch('change',{target:task});
  test('勾选事件同时更新界面与持久记录',()=>{assert.equal(document.getElementById('completed-count').textContent,'1');assert.equal(JSON.parse(fakeMemory.getItem(KEY)).done['s1-l1'],true);assert.equal(container.querySelector('[data-count="s1"]').textContent,'1 / 7进行中');});
  task.checked=false;await container.dispatch('change',{target:task});
  test('撤销勾选事件正确',()=>assert.equal(document.getElementById('completed-count').textContent,'0'));
  await click('[data-filter="done"]');
  test('已完成筛选有真实空状态',()=>{assert.equal(container.querySelectorAll('.phase').length,0);assert.ok(container.textContent.includes('还没有完成的阶段'));});
  navigate('#route/s3');
  test('深链接显示指定阶段，不会被筛选隐藏',()=>{assert.equal(container.querySelectorAll('.phase').length,6);assert.equal(container.querySelector('#phase-s3').open,true);});
  await click('[data-jump="s3"]');
  test('阶段导航恢复全部并打开指定阶段',()=>{assert.equal(container.querySelectorAll('.phase').length,6);assert.equal(container.querySelector('#phase-s3').open,true);});
  navigate('#concepts');
  test('概念页展示三类角色',()=>{assert.equal(container.querySelectorAll('.concept-card').length,3);assert.equal(container.querySelectorAll('.scenario-role').length,3);});
  const scenario=document.getElementById('scenario-select');scenario.value='debug';await container.dispatch('change',{target:scenario});
  test('场景切换产生对应解释',()=>assert.ok(document.getElementById('scenario-roles').textContent.includes('MinGW')));
  navigate('#projects/s4');
  test('项目深链接有步骤、验收、模板与记录',()=>{assert.ok(container.textContent.includes('我的工科学习笔记 Skill'));assert.equal(container.querySelectorAll('[data-task]').length,3);assert.ok(document.getElementById('project-template').textContent.includes('name: engineering-study-notes'));});
  const note=document.getElementById('project-note');note.value='<img src=x onerror=alert(1)>\n我的测试记录';await container.dispatch('input',{target:note});navigate('#projects/s4');
  test('项目笔记保存并转义 HTML',()=>{assert.ok(JSON.parse(fakeMemory.getItem(KEY)).notes.s4.includes('<img'));assert.equal(container.querySelectorAll('img').length,0);assert.ok(document.getElementById('project-note').textContent.includes('<img'));});
  await click('[data-action="copy-template"]');
  test('模板复制使用真实项目内容',()=>assert.ok(clipboard.at(-1).includes('engineering-study-notes')));
  await click('[data-action="download-template"]');await click('[data-action="export-project"]');
  test('模板和项目记录导出包含实际内容',()=>{assert.ok(downloads.at(-2).parts[0].includes('name: engineering-study-notes'));assert.ok(downloads.at(-1).parts[0].includes('我的测试记录'));});
  navigate('#resources');await click('[data-action="export-all"]');
  test('全部备份包含真实笔记与版本',()=>{const backup=JSON.parse(downloads.at(-1).parts[0]);assert.equal(backup.version,1);assert.ok(backup.notes.s4);});
  const backup=downloads.at(-1).parts[0];const input=document.getElementById('import-file');input.files=[{size:20,text:async()=>'invalid'}];await container.dispatch('change',{target:input});
  test('错误导入事件不覆盖记录并给出提示',()=>{assert.ok(document.getElementById('toast').textContent.includes('无法导入'));assert.ok(JSON.parse(fakeMemory.getItem(KEY)).notes.s4);});
  input.files=[{size:backup.length,text:async()=>backup}];await container.dispatch('change',{target:input});
  test('合法备份导入事件恢复记录',()=>{assert.ok(document.getElementById('toast').textContent.includes('已恢复'));assert.ok(JSON.parse(fakeMemory.getItem(KEY)).notes.s4);});
  await document.getElementById('theme-toggle').dispatch('click');
  test('夜间模式开关与持久记录一致',()=>{assert.equal(document.documentElement.dataset.theme,'dark');assert.equal(document.getElementById('theme-toggle').getAttribute('aria-checked'),'true');assert.equal(fakeMemory.getItem('stray-agent-theme'),'dark');});
  document.getElementById('reset-dialog').returnValue='reset';await click('[data-action="reset"]');
  test('重新打开重置对话框不会保留上次确认值',()=>assert.equal(document.getElementById('reset-dialog').returnValue,''));
  document.getElementById('reset-dialog').returnValue='cancel';await document.getElementById('reset-dialog').dispatch('close');
  test('取消重置保留记录',()=>assert.ok(JSON.parse(fakeMemory.getItem(KEY)).notes.s4));
  document.getElementById('reset-dialog').returnValue='reset';await document.getElementById('reset-dialog').dispatch('close');
  test('确认重置清空项目笔记和勾选',()=>{const data=JSON.parse(fakeMemory.getItem(KEY));assert.equal(Object.keys(data.notes).length,0);assert.equal(Object.keys(data.done).length,0);});
  console.log('\n'+checks+' checks passed. Browser visual QA is unavailable in this environment.');
}
runUI().catch(error=>{console.error(error);process.exitCode=1;});
