import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PROVIDERS, validateConfig } from './model-providers.mjs';

function protect(value, decrypt=false) {
  if(!value) return '';
  if(process.platform!=='win32') throw new Error('当前密钥加密存储仅支持 Windows');
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd().Trim(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const powershell=join(process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-Command',script],{
    input:decrypt?value:Buffer.from(value,'utf8').toString('base64'),encoding:'utf8',windowsHide:true,timeout:10000
  });
  if(result.status!==0) throw new Error('无法访问 Windows 用户加密存储，请重新配置密钥');
  return decrypt?Buffer.from(result.stdout.trim(),'base64').toString('utf8'):result.stdout.trim();
}

export class ModelSettings {
  constructor(path,codec=protect) {
    this.path=path;this.codec=codec;
    this.value={mode:'api',provider:'deepseek',protocol:'openai',baseUrl:PROVIDERS[0].baseUrl,model:'deepseek-flash',disableThinking:true,revision:randomUUID(),encryptedKey:''};
    if(existsSync(path)) {
      const saved=JSON.parse(readFileSync(path,'utf8'));
      this.value={...validateConfig(saved),revision:saved.revision||randomUUID(),encryptedKey:String(saved.encryptedKey||'')};
    }
    this.apiKey=this.value.encryptedKey?this.codec(this.value.encryptedKey,true):'';
  }
  public() { const {encryptedKey,...safe}=this.value;return {...safe,hasKey:Boolean(this.apiKey),providers:PROVIDERS}; }
  runtime() { return {...this.value,apiKey:this.apiKey}; }
  draft(input) {
    if(input.revision!==this.value.revision) throw new Error('配置已在其他页面更改，请重新打开设置');
    const config=validateConfig(input);
    const same=config.provider===this.value.provider && config.protocol===this.value.protocol && config.baseUrl===this.value.baseUrl;
    const apiKey=input.clearKey?'':typeof input.apiKey==='string' && input.apiKey.trim()?input.apiKey.trim():same?this.apiKey:'';
    if(apiKey.length>4096 || /[\r\n\x00-\x1f]/.test(apiKey)) throw new Error('密钥格式无效');
    const loopback=config.baseUrl && ['localhost','127.0.0.1','[::1]'].includes(new URL(config.baseUrl).hostname);
    if(config.mode==='api' && !apiKey && !loopback) throw new Error('请为这个服务商和地址填写 API 密钥；修改地址后不会复用旧密钥');
    return {...config,apiKey};
  }
  save(input) {
    const config=this.draft(input);
    if(config.mode==='api' && !config.model) throw new Error('请先选择或填写模型 ID');
    const {apiKey,...publicConfig}=config;
    const value={...publicConfig,encryptedKey:this.codec(apiKey),revision:randomUUID()};
    mkdirSync(dirname(this.path),{recursive:true});
    const tmp=`${this.path}.${randomUUID()}.tmp`;
    writeFileSync(tmp,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});renameSync(tmp,this.path);
    this.value=value;this.apiKey=apiKey;return this.public();
  }
}
