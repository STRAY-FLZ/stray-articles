/* 无网络依赖的记录模块；同时可在 Node 中验证。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.AgentProgress=api;
})(globalThis,function(){
  'use strict';
  const KEY='stray-agent-learning-v1';
  function createStore(storage,curriculum){
    const stages=curriculum.stages;
    const ids=new Set(stages.flatMap(s=>[...s.lessons.map(l=>l.id),...s.project.checks.map((_,i)=>s.id+'-p'+i)]));
    const stageIds=new Set(stages.map(s=>s.id));
    let state={version:1,done:{},notes:{},lastStage:'s1',updatedAt:null};
    let persistent=true,loadProblem=false,recoveryRaw=null;
    function validate(data){
      if(!data||typeof data!=='object'||Array.isArray(data)||data.version!==1) throw new Error('备份格式或版本不支持。');
      if(!data.done||typeof data.done!=='object'||Array.isArray(data.done)||!data.notes||typeof data.notes!=='object'||Array.isArray(data.notes)) throw new Error('备份缺少学习记录。');
      const done={},notes={};
      for(const [key,value] of Object.entries(data.done)){
        if(!ids.has(key)||typeof value!=='boolean') throw new Error('备份含有无法识别的任务。');
        done[key]=value;
      }
      for(const [key,value] of Object.entries(data.notes)){
        if(!stageIds.has(key)||typeof value!=='string'||value.length>10000) throw new Error('项目笔记格式不正确或超过长度限制。');
        notes[key]=value;
      }
      if(data.lastStage!==undefined&&!stageIds.has(data.lastStage)) throw new Error('备份中的阶段无效。');
      return {version:1,done,notes,lastStage:data.lastStage||'s1',updatedAt:typeof data.updatedAt==='string'?data.updatedAt.slice(0,40):null};
    }
    try{
      const raw=storage.getItem(KEY);
      if(raw){try{state=validate(JSON.parse(raw));}catch{loadProblem=true;recoveryRaw=raw;}}
    }catch{persistent=false;}
    function save(){
      state.updatedAt=new Date().toISOString();
      try{
        if(recoveryRaw!==null)storage.setItem(KEY+'-recovery',recoveryRaw);
        storage.setItem(KEY,JSON.stringify(state));persistent=true;
      }catch{persistent=false;}
      return persistent;
    }
    function stageStats(id){
      const s=stages.find(s=>s.id===id);
      if(!s) throw new Error('阶段不存在。');
      const taskIds=[...s.lessons.map(l=>l.id),...s.project.checks.map((_,i)=>id+'-p'+i)];
      const done=taskIds.filter(k=>state.done[k]).length;
      return {done,total:taskIds.length,complete:done===taskIds.length,percent:Math.round(done/taskIds.length*100)};
    }
    return {
      get state(){return JSON.parse(JSON.stringify(state));},
      get persistent(){return persistent;},
      get loadProblem(){return loadProblem;},
      isDone(id){return !!state.done[id];},
      setDone(id,value){if(!ids.has(id)||typeof value!=='boolean') throw new Error('任务无效。');state.done[id]=value;return save();},
      setNote(id,value){if(!stageIds.has(id)||typeof value!=='string'||value.length>10000) throw new Error('笔记无效。');state.notes[id]=value;return save();},
      setLastStage(id){if(!stageIds.has(id)) throw new Error('阶段无效。');state.lastStage=id;return save();},
      stageStats,
      stats(){const done=[...ids].filter(k=>state.done[k]).length;return {done,total:ids.size,percent:Math.round(done/ids.size*100),completedStages:stages.filter(s=>stageStats(s.id).complete).length};},
      nextStage(){return stages.find(s=>!stageStats(s.id).complete)||null;},
      export(){return JSON.stringify(state,null,2);},
      import(raw){if(typeof raw!=='string'||raw.length>500000) throw new Error('备份文件过大或格式错误。');state=validate(JSON.parse(raw));loadProblem=false;return save();},
      reset(){state={version:1,done:{},notes:{},lastStage:'s1',updatedAt:null};loadProblem=false;return save();}
    };
  }
  return {KEY,createStore};
});
