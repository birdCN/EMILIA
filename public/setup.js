const $=id=>document.getElementById(id);
const form=$('setupForm');
let saved=null,busy=false;
const say=(message='',error=false)=>{$('setupStatus').textContent=message;$('setupStatus').dataset.error=String(error);};
const api=async body=>{
  const response=await fetch('/api/model/settings',{method:body?'POST':'GET',headers:{'X-Emilia-Settings':'1','Content-Type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(20000),...(body?{body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok||result.ok===false)throw new Error(result.error||'无法保存，请稍后重试。');
  return result;
};
const sameAddress=()=>{
  try{return saved&&saved.provider===$('provider').value&&saved.protocol===$('protocol').value&&new URL($('baseUrl').value).href.replace(/\/+$/,'')===new URL(saved.baseUrl).href.replace(/\/+$/,'');}
  catch{return false;}
};
function keyHint(){
  $('keyHint').textContent=saved?.hasKey&&sameAddress()?'这台电脑已保存加密密钥；留空保留，输入新密钥可替换。':'密钥由 Windows 加密保存在这台电脑，不保存在浏览器中。本机免密服务可留空。';
}
function providerInfo(){
  const preset=saved.providers.find(p=>p.id===$('provider').value);
  $('providerWebsite').hidden=!preset.website;
  $('providerWebsite').href=preset.website||'#';
  $('providerWebsite').textContent=`打开 ${preset.name} 官网，获取 API Key ↗`;
  $('selectedProvider').textContent=preset.name;
  $('providerHint').textContent=preset.id==='custom'?'兼容服务需要提供接口地址、协议和模型 ID。本机免密服务的密钥可以留空。':'在服务商控制台创建 API Key，并确认账号可用余额和可调用模型。';
  $('addressHint').textContent=preset.id==='qwen'?'预填北京按量付费地址；其他地区或工作空间请使用对应地址和密钥。':'使用官方地址。其他地区或自建服务请按服务商文档修改。';
  keyHint();
}
function step(number){
  $('providerStep').hidden=number!==1;$('credentialsStep').hidden=number!==2;
  // Disabled hidden fields cannot block native form validation on another step.
  $('providerStep').disabled=number!==1;$('credentialsStep').disabled=number!==2;
  $('stepOne').toggleAttribute('aria-current',number===1);$('stepTwo').toggleAttribute('aria-current',number===2);
  $('stepOne').getAttribute('aria-current')!==null&&$('stepOne').setAttribute('aria-current','step');
  $('stepTwo').getAttribute('aria-current')!==null&&$('stepTwo').setAttribute('aria-current','step');
}
async function load(){
  $('retryLoad').hidden=true;form.setAttribute('aria-busy','true');
  try{
    saved=await api();
    $('provider').replaceChildren(...saved.providers.map(p=>new Option(p.name,p.id)));
    $('provider').value=saved.provider;
    for(const name of ['baseUrl','protocol','model'])$(name).value=saved[name]||'';
    if(!saved.hasKey&&saved.setupRequired){
      const preset=saved.providers.find(p=>p.id===saved.provider);
      $('model').value=preset.model||'';
    }
    $('apiKey').value='';providerInfo();step(1);say();
  }catch(error){say('无法读取本机设置。请确认 Emilia 正在运行，然后重新读取。',true);$('retryLoad').hidden=false;}
  finally{form.removeAttribute('aria-busy');}
}
$('provider').addEventListener('change',()=>{
  const preset=saved.providers.find(p=>p.id===$('provider').value);
  $('baseUrl').value=preset.baseUrl;$('protocol').value=preset.protocol;$('model').value=preset.model;
  $('apiKey').value='';$('advancedSettings').open=preset.id==='custom';providerInfo();say();
});
$('nextStep').addEventListener('click',()=>{if(saved){step(2);$('model').focus();}});
$('previousStep').addEventListener('click',()=>{if(!busy){step(1);say();$('provider').focus();}});
for(const name of ['baseUrl','protocol'])$(name).addEventListener('input',keyHint);
$('retryLoad').addEventListener('click',load);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!saved)return;
  // Reveal advanced fields if their native URL validation needs attention.
  if(!$('baseUrl').checkValidity())$('advancedSettings').open=true;
  if(!form.reportValidity())return;
  const payload={revision:saved.revision,mode:'api',provider:$('provider').value,baseUrl:$('baseUrl').value,protocol:$('protocol').value,model:$('model').value,apiKey:$('apiKey').value,disableThinking:true};
  busy=true;$('saveSettings').disabled=true;$('previousStep').disabled=true;form.setAttribute('aria-busy','true');say('正在加密保存设置…');
  try{
    saved=await api(payload);$('apiKey').value='';form.hidden=true;$('setupDone').hidden=false;say();$('setupDone').focus();
  }catch(error){say(error.name==='TimeoutError'?'保存超时，请确认 Emilia 正在运行后重试。':error.message,true);}
  finally{busy=false;$('saveSettings').disabled=false;$('previousStep').disabled=false;form.removeAttribute('aria-busy');}
});
// Keep credentials only in this form while it is open.
addEventListener('pagehide',()=>{$('apiKey').value='';});
void load();
