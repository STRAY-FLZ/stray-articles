(function(){
  'use strict';
  const curriculum=globalThis.AgentCurriculum;
  const stages=curriculum.stages;
  const $=id=>document.getElementById(id);
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let storage;
  try{storage=window.localStorage;}catch{storage={getItem(){throw new Error();},setItem(){throw new Error();}};}
  let store=AgentProgress.createStore(storage,curriculum);
  let activeView='route',activeStage=store.state.lastStage,filter='all',toastTimer;
  const container=$('view-container');
  const source=id=>curriculum.sources.find(s=>s.id===id);
  function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>{$('toast').hidden=true;},4200);}
  function applyTheme(theme){
    document.documentElement.dataset.theme=theme;
    const dark=theme==='dark';
    $('theme-toggle').setAttribute('aria-checked',String(dark));
    $('theme-toggle').title=dark?'切换到日间模式':'切换到夜间模式';
    $('theme-toggle').firstElementChild.textContent=dark?'☀':'☾';
  }
  const media=window.matchMedia('(prefers-color-scheme: dark)');
  let manualTheme=null;
  try{manualTheme=storage.getItem('stray-agent-theme');}catch{}
  applyTheme(manualTheme==='dark'||manualTheme==='light'?manualTheme:media.matches?'dark':'light');
  $('theme-toggle').addEventListener('click',()=>{manualTheme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(manualTheme);try{storage.setItem('stray-agent-theme',manualTheme);}catch{}});
  media.addEventListener?.('change',e=>{if(!manualTheme)applyTheme(e.matches?'dark':'light');});
  function updateProgress(){
    const stats=store.stats(),next=store.nextStage();
    $('progress-percent').innerHTML=stats.percent+'<span>%</span>';
    $('progress-ring').style.setProperty('--progress',stats.percent+'%');
    $('progress-ring').setAttribute('aria-label','学习进度 '+stats.percent+'%');
    $('completed-count').textContent=stats.done;
    $('total-count').textContent=stats.total;
    $('completed-stages').textContent=stats.completedStages+' / '+stages.length+' 阶段';
    $('next-title').textContent=next?next.title:'六个阶段已完成，回看你的成果';
    $('continue-hero').innerHTML=(stats.done?'继续学习':'开始学习')+' <span aria-hidden="true">↗</span>';
    $('continue-panel').innerHTML=(next?'进入阶段':'回看成果')+' <span aria-hidden="true">→</span>';
    $('storage-status').textContent=store.persistent?'进度自动保存在当前浏览器，可导出备份。':'当前浏览器无法持久保存，请及时导出备份。';
    for(const s of stages){
      const count=container.querySelector('[data-count="'+s.id+'"]');
      if(count){const stat=store.stageStats(s.id);count.innerHTML='<strong>'+stat.done+' / '+stat.total+'</strong>'+(stat.complete?'已完成':stat.done?'进行中':'待开始');}
    }
  }
  function heading(label,title,description){return '<div class="section-heading"><div><span class="eyebrow">'+label+'</span><h2>'+title+'</h2></div><p>'+description+'</p></div>';}
  function renderRoute(){
    const visible=stages.filter(s=>filter==='all'||(filter==='done'?store.stageStats(s.id).complete:!store.stageStats(s.id).complete));
    container.innerHTML=heading('THE LEARNING PATH','你的六个阶段','先掌握概念，再做项目。所有阶段均可自由浏览。')+
      '<div class="route-layout"><aside class="route-aside" aria-label="阶段导航"><p class="aside-title">CHAPTER INDEX</p><div class="stage-jumps">'+stages.map(s=>'<button class="stage-jump" data-jump="'+s.id+'" '+(s.id===activeStage?'aria-current="step"':'')+'><span>'+s.number+'</span>'+escape(s.title)+'</button>').join('')+'</div><p class="aside-note">学习项读懂后勾选，项目项在成果验证后勾选。无需急着完成每一项。</p></aside><section aria-label="学习阶段"><div class="filters" aria-label="按进度筛选">'+[['all','全部阶段'],['todo','未完成'],['done','已完成']].map(([key,label])=>'<button class="filter" data-filter="'+key+'" aria-pressed="'+(filter===key)+'">'+label+'</button>').join('')+'</div><div id="phases">'+(visible.length?visible.map(s=>{
        const stat=store.stageStats(s.id);
        return '<details class="phase" id="phase-'+s.id+'" data-stage="'+s.id+'" '+(s.id===activeStage?'open':'')+'><summary class="phase-summary"><span class="phase-number">'+s.number+'</span><span><span class="phase-title">'+escape(s.title)+'</span><span class="phase-subtitle">'+escape(s.subtitle)+' · '+s.time+'</span></span><span class="phase-count" data-count="'+s.id+'"><strong>'+stat.done+' / '+stat.total+'</strong>'+(stat.complete?'已完成':stat.done?'进行中':'待开始')+'</span><span class="phase-toggle" aria-hidden="true"></span></summary><div class="phase-body"><div class="phase-goal"><span class="small-label">阶段目标</span><p>'+escape(s.goal)+'</p></div><p class="prerequisite">准备条件：'+escape(s.prerequisite)+'</p>'+s.lessons.map(l=>'<div class="lesson"><input type="checkbox" class="check-input" id="'+l.id+'" data-task="'+l.id+'" aria-label="标记已学会：'+escape(l.title)+'" '+(store.isDone(l.id)?'checked':'')+'><details><summary>'+escape(l.title)+'</summary><p>'+escape(l.body)+'</p></details></div>').join('')+'<div class="project-mini"><div><span class="eyebrow">PERSONAL PROJECT '+s.number+'</span><strong>'+escape(s.project.title)+'</strong><p>'+escape(s.project.deliverable)+'</p></div><button class="text-button" data-project="'+s.id+'">动手做项目 ↗</button></div><p class="phase-resources">延伸阅读：'+s.sources.map(id=>{const r=source(id);return '<a href="'+r.url+'" target="_blank" rel="noopener noreferrer">'+escape(r.title)+' ↗</a>';}).join(' · ')+'</p></div></details>';
      }).join(''):'<div class="empty-state">'+(filter==='done'?'还没有完成的阶段。<br>完成一个阶段的学习项与项目验收后，它会出现在这里。':'所有阶段都完成了。<br>去项目工作台回看你的成果，或继续完善笔记。')+'</div>')+'</div></section></div>';
    container.querySelectorAll('.phase').forEach(el=>el.addEventListener('toggle',()=>{
      if(!el.open)return;
      activeStage=el.dataset.stage;store.setLastStage(activeStage);
      container.querySelectorAll('.phase').forEach(other=>{if(other!==el)other.open=false;});
      container.querySelectorAll('[data-jump]').forEach(button=>{if(button.dataset.jump===activeStage)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});
      updateProgress();
    }));
  }
  function renderScenario(id){
    const scene=curriculum.scenarios.find(s=>s.id===id)||curriculum.scenarios[0];
    $('scenario-roles').innerHTML=[['Agent · 协调与决策',scene.agent],['插件 · 能力入口',scene.plugin],['Skill · 方法与规范',scene.skill]].map(([name,text])=>'<div class="scenario-role"><h4>'+name+'</h4><p>'+escape(text)+'</p></div>').join('');
  }
  function renderConcepts(){
    const cards=[['01','Agent','负责推进任务','围绕目标选择行动，调用工具，检查实际反馈，再决定继续、调整或结束。这里采用强调自主决策的定义。','例：定位未知的 C 程序错误，根据编译结果决定下一步。'],['02','插件 / Plugin','扩展应用的能力入口','插件是应用中的扩展包或入口，可能带来工具、服务连接、Skill 或界面。具体能力与可用权限取决于宿主应用。','例：接入文件检索，读到你指定的课程笔记。'],['03','Skill','保存可复用的方法','把任务流程、约束和参考资源组织成方法包，让 Agent 按需使用。Skill 可以调用已有工具，但不自动获得权限。','例：先概念与条件，再推导与结论的工科笔记规范。']];
    container.innerHTML=heading('THE CONCEPT MAP','三个概念，各司其职','职责不同，可以组合；并不是升级关系。')+'<div class="concept-grid">'+cards.map(([n,name,purpose,body,example])=>'<article class="concept-card"><span class="concept-number">'+n+'</span><h3>'+name+'</h3><p class="concept-purpose">'+purpose+'</p><p>'+body+'</p><div class="concept-example"><strong>在你的学习里</strong>'+example+'</div></article>').join('')+'</div><div class="callout"><strong>把职责放在同一个任务中理解：</strong>Agent 安排并检查任务，插件提供可用的扩展能力，Skill 规定某类任务怎么完成。固定流程可以先用工作流实现；不必把每次 AI 对话都称作 Agent。</div><section class="scenario"><div class="scenario-head"><h3>换一个场景，看它们怎么配合</h3><select id="scenario-select" aria-label="选择任务场景">'+curriculum.scenarios.map(s=>'<option value="'+s.id+'">'+escape(s.title)+'</option>').join('')+'</select></div><div class="scenario-roles" id="scenario-roles" aria-live="polite"></div></section><section class="glossary"><h3>你可能还想厘清</h3>'+curriculum.glossary.map(item=>'<details><summary>'+escape(item.title)+'</summary><p>'+escape(item.body)+'</p></details>').join('')+'</section><p class="phase-resources">概念参考：<a href="'+source('agents').url+'" target="_blank" rel="noopener noreferrer">Agent 与工作流</a> · <a href="'+source('skills').url+'" target="_blank" rel="noopener noreferrer">Agent Skills 规范</a> · <a href="'+source('mcp').url+'" target="_blank" rel="noopener noreferrer">MCP 架构</a></p>';
    renderScenario('notes');
  }
  function renderProjects(){
    const s=stages.find(s=>s.id===activeStage)||stages[0],p=s.project,note=store.state.notes[s.id]||'';
    container.innerHTML=heading('BUILD SOMETHING REAL','项目工作台','成果在你的 AI 应用或代码环境中完成，这里记录过程与验收。')+'<div class="project-selector" aria-label="选择个人项目">'+stages.map(stage=>'<button class="project-tab" data-project="'+stage.id+'" aria-pressed="'+(s.id===stage.id)+'">'+stage.number+' '+escape(stage.project.title.split(' · ')[0])+'</button>').join('')+'</div><div class="project-layout"><article class="project-brief"><span class="eyebrow">PROJECT '+s.number+' · '+s.tag+' · '+s.time+'</span><h3>'+escape(p.title)+'</h3><p class="project-intro">'+escape(p.intro)+'</p><h4>动手步骤</h4><ol class="project-steps">'+p.steps.map(t=>'<li>'+escape(t)+'</li>').join('')+'</ol><div class="deliverables"><h4>完成后，留下这些成果</h4><p>'+escape(p.deliverable)+'</p></div><h4>项目验收 <span class="small-label">验证成果后再勾选</span></h4><ul class="acceptance">'+p.checks.map((text,i)=>'<li><label><input type="checkbox" class="check-input" data-task="'+s.id+'-p'+i+'" '+(store.isDone(s.id+'-p'+i)?'checked':'')+'><span>'+escape(text)+'</span></label></li>').join('')+'</ul><details class="template-block"><summary>打开起步模板，复制后在你的应用中使用</summary><pre id="project-template">'+escape(p.template)+'</pre><div class="template-actions"><button class="secondary-button" data-action="copy-template">复制模板</button><button class="secondary-button" data-action="download-template">下载模板</button></div><p class="prerequisite">这是可编辑的教学起点；复制或下载不会安装插件，也不会运行 Agent。阶段 04 的模板采用 SKILL.md 格式，安装需按宿主说明完成。</p></details></article><aside class="project-notes"><h4>我的项目记录</h4><p>记录你的成果位置、验证结果与尚未解决的问题。内容只保存在当前浏览器。</p><label for="project-note">项目笔记</label><textarea id="project-note" data-note="'+s.id+'" maxlength="10000" placeholder="成果文件 / 链接：&#10;测试输入与实际结果：&#10;我的理解：&#10;遇到的问题与下次改进：">'+escape(note)+'</textarea><div class="notes-meta"><span id="note-status">'+(store.persistent?'自动保存':'仅在当前页面暂存')+'</span><span id="note-length">'+note.length+' / 10000</span></div><button class="secondary-button" data-action="export-project">导出项目记录 .md</button><button class="secondary-button" data-jump="'+s.id+'">返回阶段 '+s.number+' →</button><p>更换设备前，可在“资料与备份”导出全部进度，再在另一台设备导入。</p></aside></div>';
  }
  function renderResources(){
    container.innerHTML=heading('READ, VERIFY & KEEP','资料与备份','优先读一手文档，用实际成果验证理解。')+'<div class="resource-layout"><section aria-label="官方资料">'+curriculum.sources.map(s=>'<a class="resource-row" href="'+s.url+'" target="_blank" rel="noopener noreferrer"><span class="eyebrow">'+s.org+'</span><h3>'+escape(s.title)+'<span aria-hidden="true">↗</span></h3><p>'+escape(s.description)+'</p></a>').join('')+'<div class="callout"><strong>建议的阅读方法：</strong>先带着一个项目问题去阅读，再回到项目核对。第一阶段不必掌握 SDK、协议参数或多个 Agent 的架构。本站课程与文档链接整理于 2026 年 10 月 7 日，安装与接口细节以当前官方说明为准。</div></section><aside class="backup-panel"><h3>保存你的学习记录</h3><p>包含全部勾选、六个项目笔记和最近学习阶段。默认自动保存在当前浏览器，不会跨设备同步；清除浏览器数据可能删除记录。</p><button class="button" data-action="export-all">导出全部进度 <span aria-hidden="true">↓</span></button><button class="secondary-button" data-action="import-all">从备份恢复进度 ↑</button><input type="file" id="import-file" accept=".json,application/json" hidden><p>JSON 备份可用于换设备或恢复记录。导入前会提示确认；格式不匹配的文件不会覆盖现有记录。</p><details class="backup-detail"><summary>记录与隐私说明</summary><p>项目笔记和进度留在你的浏览器。网站没有接入模型 API、广告或分析服务；打开资料链接将前往对应网站。本站的访问范围由私密托管控制。</p><p>学习记录不会包含在源码集成包中；备份 JSON 请单独保存。</p></details><a class="secondary-button" href="https://stray-agent-learning.stray9728.chatgpt.site/downloads/agent-learning-github.zip" download>下载 GitHub 集成包 ↓</a><p>包内文件按 tools/agent-learning/ 整理，可用于维护与本地运行。</p><button class="reset-button" data-action="reset">重置当前学习记录</button></aside></div>';
  }
  function render(){
    if(activeView==='concepts')renderConcepts();else if(activeView==='projects')renderProjects();else if(activeView==='resources')renderResources();else renderRoute();
    document.querySelectorAll('[data-view]').forEach(a=>{if(a.dataset.view===activeView)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    document.title=({route:'学习路线',concepts:'概念地图',projects:'项目工作台',resources:'资料与备份'}[activeView])+' · Agent Lab · Stray';
    updateProgress();
  }
  function routeFromHash(scroll){
    const parts=window.location.hash.slice(1).split('/');
    activeView=['route','concepts','projects','resources'].includes(parts[0])?parts[0]:'route';
    if(stages.some(s=>s.id===parts[1])){activeStage=parts[1];if(activeView==='route')filter='all';}
    render();
    if(scroll){const target=activeView==='route'&&parts[1]?$('phase-'+activeStage):container;target?.scrollIntoView({behavior:mediaReduced()?'instant':'smooth',block:'start'});}
  }
  function mediaReduced(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
  function navigate(view,id){
    if(id){activeStage=id;store.setLastStage(id);}
    const hash='#'+view+(id?'/'+id:'');
    if(window.location.hash===hash)routeFromHash(true);else window.location.hash=hash;
  }
  function continueLearning(){const next=store.nextStage();if(next){filter='all';navigate('route',next.id);}else navigate('projects',activeStage);}
  $('continue-hero').addEventListener('click',continueLearning);
  $('continue-panel').addEventListener('click',continueLearning);
  window.addEventListener('hashchange',()=>routeFromHash(true));
  function download(content,name,type){
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  container.addEventListener('click',async e=>{
    const jump=e.target.closest('[data-jump]'),project=e.target.closest('[data-project]'),filterButton=e.target.closest('[data-filter]'),action=e.target.closest('[data-action]');
    if(jump){filter='all';navigate('route',jump.dataset.jump);return;}
    if(project){navigate('projects',project.dataset.project);return;}
    if(filterButton){filter=filterButton.dataset.filter;renderRoute();updateProgress();container.querySelector('[data-filter="'+filter+'"]')?.focus();return;}
    if(!action)return;
    const s=stages.find(s=>s.id===activeStage)||stages[0];
    if(action.dataset.action==='export-all'){download(store.export(),'stray-agent-progress.json','application/json');toast('已导出全部学习进度和项目笔记。');}
    else if(action.dataset.action==='import-all')$('import-file').click();
    else if(action.dataset.action==='reset'){$('reset-dialog').returnValue='';$('reset-dialog').showModal();}
    else if(action.dataset.action==='download-template'){download(s.project.template,s.id==='s4'?'SKILL.md':'project-'+s.number+'-starter.md','text/markdown;charset=utf-8');toast('已下载起步模板。');}
    else if(action.dataset.action==='copy-template'){
      try{await navigator.clipboard.writeText(s.project.template);toast('模板已复制。');}catch{toast('浏览器未允许复制，可使用“下载模板”。');}
    }else if(action.dataset.action==='export-project'){
      const text='# '+s.project.title+'\n\n'+s.project.intro+'\n\n## 项目验收\n\n'+s.project.checks.map((t,i)=>'- ['+(store.isDone(s.id+'-p'+i)?'x':' ')+'] '+t).join('\n')+'\n\n## 我的记录\n\n'+(store.state.notes[s.id]||'尚未填写记录。')+'\n\n## 成果要求\n\n'+s.project.deliverable+'\n';
      download(text,'project-'+s.number+'-notes.md','text/markdown;charset=utf-8');toast('已导出项目记录。');
    }
  });
  container.addEventListener('input',e=>{
    if(!e.target.dataset.note)return;
    const value=e.target.value,saved=store.setNote(e.target.dataset.note,value);
    $('note-length').textContent=value.length+' / 10000';$('note-status').textContent=saved?'已自动保存':'保存失败，请导出备份';updateProgress();
  });
  container.addEventListener('change',async e=>{
    if(e.target.dataset.task){
      const saved=store.setDone(e.target.dataset.task,e.target.checked);updateProgress();
      if(!saved)toast('无法持久保存，当前记录请及时导出。');
      if(activeView==='route'&&filter!=='all'){renderRoute();updateProgress();}
    }else if(e.target.id==='scenario-select')renderScenario(e.target.value);
    else if(e.target.id==='import-file'){
      const file=e.target.files[0];if(!file)return;
      try{
        if(file.size>1000000)throw new Error('备份文件过大，请选择本网站导出的 JSON。');
        const raw=await file.text();
        const trial=AgentProgress.createStore({getItem(){return null;},setItem(){}},curriculum);trial.import(raw);
        if(!window.confirm('导入将替换当前进度和项目笔记。建议先导出原记录。确定恢复这份备份吗？'))return;
        const saved=store.import(raw);activeStage=store.state.lastStage;render();toast(saved?'学习记录已恢复。':'已恢复，但浏览器无法持久保存，请导出备份。');
      }catch(error){toast('无法导入：'+(error instanceof SyntaxError?'文件不是有效的 JSON。':error.message));}
      finally{const input=$('import-file');if(input)input.value='';}
    }
  });
  $('reset-dialog').addEventListener('close',()=>{
    if($('reset-dialog').returnValue!=='reset')return;
    store.reset();activeStage='s1';filter='all';render();toast('当前学习记录已重置。');
  });
  window.addEventListener('storage',e=>{
    if(e.key==='stray-agent-theme'){manualTheme=e.newValue;applyTheme(e.newValue==='dark'?'dark':e.newValue==='light'?'light':media.matches?'dark':'light');}
    if(e.key===AgentProgress.KEY||e.key===null){store=AgentProgress.createStore(storage,curriculum);render();toast('学习记录已与此浏览器的另一页面同步。');}
  });
  routeFromHash(false);
  if(store.loadProblem)toast('发现旧记录格式异常，已保留原数据；可导出已有备份或重新开始。');
})();
