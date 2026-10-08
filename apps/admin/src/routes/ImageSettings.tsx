import { useEffect, useState } from 'react';
import { api } from '../api/client';
type Config = {baseUrl: string; enabled: boolean; hasKey: boolean; ready: boolean; model: string; source: string};
export function ImageSettings() {
  const [config,setConfig] = useState<Config|null>(null), [baseUrl,setBaseUrl] = useState('');
  const [key,setKey] = useState(''), [enabled,setEnabled] = useState(true), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const apply = (c: Config) => { setConfig(c); setBaseUrl(c.baseUrl); setEnabled(c.enabled); setKey(''); };
  useEffect(() => { let active = true; api.get<Config>('/api/admin/config/image').then(c => { if(active) apply(c); }).catch(() => { if(active) setMessage('配置加载失败，请检查管理员登录。'); }); return () => { active = false; }; }, []);
  return <section style={{maxWidth:680}}>
    <h1>图片服务</h1><p>小手机生图和参考图编辑共用此配置。保存后立即生效，重启后保留。</p>
    {!config ? <p role="status">{message || '加载中…'}</p> : <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setMessage('');
      try { apply(await api.put<Config>('/api/admin/config/image',{baseUrl,apiKey:key,enabled})); setMessage('已保存，后续生图请求使用此配置。'); }
      catch { setMessage('保存失败，请检查 HTTPS 地址、Key 格式及管理员权限。'); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy} style={{border:0,padding:0,display:'grid',gap:16}}>
        <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> 启用图片服务</label>
        <label>API 地址<input style={{display:'block',width:'100%'}} type="url" required value={baseUrl} placeholder="https://服务商域名/v1" onChange={e=>setBaseUrl(e.target.value)}/></label>
        <label>API Key<input style={{display:'block',width:'100%'}} type="password" autoComplete="new-password" value={key} placeholder={config.hasKey?'已配置，留空保留原 Key':'请输入 API Key'} onChange={e=>setKey(e.target.value)}/></label>
        <p>模型：{config.model}<br/>当前状态：{config.ready?'已配置并启用':'未启用或配置不完整'}<br/>配置来源：{config.source==='admin'?'后台保存':'服务器环境配置'}</p>
        <button className="btn" type="submit">{busy?'保存中…':'保存配置'}</button>
      </fieldset><p role="status">{message}</p>
    </form>}
  </section>;
}
