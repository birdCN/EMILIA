export function initModelSettings({ canChange, onSaved }) {
  const dialog=document.querySelector('#modelSettingsDialog');
  const form=document.querySelector('#modelSettingsForm');
  const field=name=>form.elements.namedItem(name);
  const status=document.querySelector('#modelSettingsResult');
  const keyNote=document.querySelector('#modelKeyNote');
  const modelList=document.querySelector('#modelOptions');
  const modelPicker=document.querySelector('#modelPicker');
  const clearModels=()=>{modelList.replaceChildren();modelPicker.hidden=true;};
  let saved=null,busy=false;
  const say=(message,error=false)=>{status.textContent=message;status.dataset.error=String(error);};
  const api=async(path,body)=>{
    const response=await fetch(`/api/model/${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Emilia-Settings':'1'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(path==='test'?75000:20000)});
    const result=await response.json();if(!response.ok || result.ok===false) throw new Error(result.error||'请求失败');return result;
  };
  const payload=()=>({revision:saved.revision,mode:field('mode').value,provider:field('provider').value,protocol:field('protocol').value,
    baseUrl:field('baseUrl').value,model:field('model').value,apiKey:field('apiKey').value,clearKey:field('clearKey').checked,disableThinking:field('disableThinking').checked});
  const keyHint=()=>{
    const same=saved && saved.provider===field('provider').value && saved.protocol===field('protocol').value && saved.baseUrl===field('baseUrl').value.replace(/\/+$/,'');
    keyNote.textContent=same&&saved.hasKey?'已有加密密钥；留空保留，填入新值替换。':'当前地址没有可复用的密钥，请填写；本机免密服务可留空。';
    field('apiKey').placeholder=same&&saved.hasKey?'已保存，留空不修改':'粘贴服务商 API Key';
  };
  const renderMode=()=>{
    document.querySelector('#apiSettingsFields').hidden=field('mode').value!=='api';
    document.querySelector('#codexSettingsInfo').hidden=field('mode').value!=='codex';
    document.querySelector('#testApiModel').hidden=field('mode').value!=='api';
  };
  const providerLinks=()=>{
    const preset=saved.providers.find(p=>p.id===field('provider').value);
    const link=document.querySelector('#providerWebsite');link.hidden=!preset.website;link.href=preset.website||'#';link.textContent=`前往 ${preset.name} 获取密钥 ↗`;
    document.querySelector('#providerAddressHint').textContent=preset.id==='qwen'?'预填北京按量付费地址；其他地区或工作空间请展开高级设置修改，密钥必须与地区匹配。':'预填官方调用地址；自建代理或其他地区可在高级设置修改。';
  };
  const fill=config=>{
    saved=config;
    field('provider').replaceChildren(...config.providers.map(p=>new Option(p.name,p.id)));
    for(const name of ['mode','provider','protocol','baseUrl','model'])field(name).value=config[name];
    field('apiKey').value='';field('clearKey').checked=false;field('disableThinking').checked=config.disableThinking;
    clearModels();renderMode();providerLinks();keyHint();
  };
  const perform=async action=>{
    if(busy)return;busy=true;
    const controls=[...form.querySelectorAll('button,input,select')];controls.forEach(el=>el.disabled=true);
    dialog.setAttribute('aria-busy','true');
    try{await action();}catch(error){say(error.name==='TimeoutError'?'请求超时，请检查网络或稍后重试。':error.message,true);}
    finally{busy=false;controls.forEach(el=>el.disabled=false);dialog.removeAttribute('aria-busy');}
  };
  document.querySelector('#openModelSettings').addEventListener('click',async()=>{
    if(!canChange()){onSaved('请先等待当前回复或录音完成');return;}
    dialog.showModal();say('正在读取本机配置…');
    await perform(async()=>{fill(await api('settings'));say('选择接入方式。修改仅在点击“保存并应用”后生效。');});
  });
  document.querySelector('#closeModelSettings').addEventListener('click',()=>{if(!busy){field('apiKey').value='';dialog.close();}});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else field('apiKey').value='';});
  field('mode').addEventListener('change',renderMode);
  field('provider').addEventListener('change',()=>{
    const preset=saved.providers.find(p=>p.id===field('provider').value);
    field('protocol').value=preset.protocol;field('baseUrl').value=preset.baseUrl;field('model').value=preset.model;
    field('apiKey').value='';field('clearKey').checked=false;clearModels();providerLinks();keyHint();
    if(preset.id==='custom')document.querySelector('#modelAdvanced').open=true;
    say('已切换配置草稿，尚未应用。更换服务商或地址后，需要重新填写密钥。');
  });
  for(const name of ['baseUrl','protocol'])field(name).addEventListener('input',()=>{field('apiKey').value='';clearModels();keyHint();});
  field('model').addEventListener('input',()=>{modelList.value=field('model').value.trim();});
  modelList.addEventListener('change',()=>{
    if(!modelList.value)return;
    field('model').value=modelList.value;
    say(`已选择 ${modelList.value}。点击“保存并应用”后生效。`);
  });
  document.querySelector('#loadApiModels').addEventListener('click',()=>perform(async()=>{
    say('正在向所选服务商读取模型列表…');
    const result=await api('models',payload());
    modelList.replaceChildren(new Option('请选择模型',''),...result.models.map(id=>new Option(id,id)));
    const current=field('model').value.trim();
    modelList.value=result.models.includes(current)?current:'';modelPicker.hidden=false;
    say(`已读取 ${result.models.length} 个模型，请在下方列表选择；也可手动填写模型 ID。点击“保存并应用”后生效。`);
  }));
  document.querySelector('#testApiModel').addEventListener('click',()=>perform(async()=>{
    say('正在发送一条不含学习资料的测试请求，可能产生少量 API 费用…');
    const result=await api('test',payload());say(`${result.message}。测试首段 ${(result.firstDeltaMs/1000).toFixed(2)} 秒。配置尚未保存。`);
  }));
  form.addEventListener('submit',event=>{event.preventDefault();void perform(async()=>{
    if(!saved)throw new Error('请重新打开配置窗口');
    if(!canChange())throw new Error('请等待当前操作完成后再切换');
    say('正在加密保存配置…');fill(await api('settings',payload()));say('已应用。下一轮使用新配置，学习档案和当前课堂保留。');
    onSaved();
  });});
}
