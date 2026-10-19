import { useEffect, useState, type CSSProperties } from 'react';
import { completionContent, readingBlocks, type PhoneInspectionPreview } from '@yelan/shared';
import { getAuthHeaders, getBase } from '../api/client';
import { inspectionHtml } from '../lib/inspection-html';
import { RecordReader } from './RecordReader';
import { useFullscreen } from '../lib/use-fullscreen';
import { resolveInspectionArchive } from '../lib/inspection-archive';
import { RetainedMedia } from './RetainedMedia';
import './InspectionPreview.css';

type Item = Record<string,unknown>;
const obj = (v:unknown):Item => v&&typeof v==='object'&&!Array.isArray(v)?v as Item:{};
const list = (v:unknown):Item[] => Array.isArray(v)?v.map(obj):[];
const str = (v:unknown):string => typeof v==='string'?v:'';
function useAssets(recordKey:string,preview:PhoneInspectionPreview,visibleData:string){
  const [urls,setUrls]=useState<Record<string,string>>({}),[dataUrls,setDataUrls]=useState<Record<string,string>>({}),[failed,setFailed]=useState(false),[loading,setLoading]=useState(false);
  useEffect(()=>{
    const controller=new AbortController(), created:string[]=[];let active=true;
    setUrls({});setDataUrls({});setFailed(false);setLoading(true);
    void(async()=>{
      const normal:Record<string,string>={},inline:Record<string,string>={};
      const assets=preview.assets.filter(a=>a.state==='stored'&&a.id&&visibleData.includes(a.ref)&&/^(image|audio|video|font)\/|^text\/css$/.test(a.mime||''));
      for(let offset=0;offset<assets.length;offset+=4)await Promise.all(assets.slice(offset,offset+4).map(async asset=>{
        try{
          const res=await fetch(`${getBase()}/api/admin/phone-inspections/${encodeURIComponent(recordKey)}/assets/${asset.id}`,{headers:getAuthHeaders(),signal:controller.signal});
          if(!res.ok)throw new Error('missing');const blob=await res.blob();
          if(!active)return;const url=URL.createObjectURL(blob);created.push(url);normal[asset.ref]=url;
          inline[asset.ref]=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
          if(active){setUrls({...normal});setDataUrls({...inline});}
        }catch{if(active)setFailed(true);}
      }));
      if(active)setLoading(false);
    })();
    return()=>{active=false;controller.abort();created.forEach(url=>URL.revokeObjectURL(url));};
  },[recordKey,preview,visibleData]);
  return {urls,dataUrls,failed,loading};
}
function Media({value,urls,label='媒体'}:{value:unknown;urls:Record<string,string>;label?:string}){
  const [open,setOpen]=useState(false);
  const ref=str(value),src=urls[ref];
  if(!ref)return null;
  if(!src)return <p className="inspection-missing">{label}未留存或正在加载</p>;
  // Object URLs are fetched through admin authentication, never embedded tokens.
  return <><button className="inspection-image-button" onClick={()=>setOpen(true)}><img src={src} alt={label}/></button>{open&&<div className="inspection-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={()=>setOpen(false)} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}><button className="btn" autoFocus>关闭</button><img src={src} alt={label}/></div>}</>;
}
function Prose({value,assets}:{value:unknown;assets:Record<string,string>}){
  const [page,setPage]=useState(0);
  useEffect(()=>setPage(0),[value]);
  const text=str(value);
  if(text.startsWith('inspection-asset://'))return null;
  if(/<(?:div|p|span|table|img|svg|style|br)[\s/>]/i.test(text))return <iframe title="排版内容预览" sandbox="" className="inspection-rich-frame" srcDoc={inspectionHtml(text,assets)}/>;
  function readable(v:unknown):unknown{if(typeof v==='string')return v.replace(/inspection-asset:\/\/[^\s"'<>)]*/g,'〔媒体附件〕');if(Array.isArray(v))return v.map(readable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([key,item])=>[key,readable(item)]));return v;}
  const cleaned=readable(value),prose=readingBlocks(cleaned).map(block=>block.text).join('\n\n');
  if(prose.length>12000){const count=Math.ceil(prose.length/12000),index=Math.min(page,count-1);return <><div className="record-prose">{prose.slice(index*12000,(index+1)*12000)}</div><div className="inspection-scene-tabs"><button className="btn" disabled={index===0} onClick={()=>setPage(p=>p-1)}>上一页内容</button><span>第 {index+1}/{count} 页 · 完整留存 {prose.length} 字符</span><button className="btn" disabled={index===count-1} onClick={()=>setPage(p=>p+1)}>下一页内容</button></div></>;}
  return <RecordReader value={cleaned}/>;
}
export function InspectionPreview({recordKey,preview,title}:{recordKey:string;preview:PhoneInspectionPreview;title:string}){
  const [resolved,setResolved]=useState<PhoneInspectionPreview|null>(null),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();let active=true;setResolved(null);setError('');void resolveInspectionArchive(preview,async id=>{const response=await fetch(`${getBase()}/api/admin/phone-inspections/${encodeURIComponent(recordKey)}/assets/${id}`,{headers:getAuthHeaders(),signal:controller.signal});if(!response.ok)throw new Error();return response.arrayBuffer();}).then(value=>{if(active)setResolved(value);}).catch(()=>{if(active)setError('完整预览加载失败，请重新选择记录或刷新。');});return()=>{active=false;controller.abort();};},[preview,recordKey]);
  if(error)return <p role="alert">{error}</p>;
  if(!resolved)return <p role="status">正在读取完整预览…</p>;
  return <InspectionPreviewBody recordKey={recordKey} preview={resolved} title={title}/>;
}
function InspectionPreviewBody({recordKey,preview,title}:{recordKey:string;preview:PhoneInspectionPreview;title:string}){
  const [size,setSize]=useState('390'),[scene,setScene]=useState(0),[tab,setTab]=useState(0),[feedDetail,setFeedDetail]=useState(false),[articleView,setArticleView]=useState(false),[resourcePage,setResourcePage]=useState(0);
  const {ref:root,fullscreen,toggle}=useFullscreen();
  const d=preview.data;
  const scenes=list(d.scenes), messages=list(d.messages||d.transcript), chapters=list(d.chapters), appearance=obj(d.appearance),theme=obj(appearance.cssOverrides),article=obj(d.article);
  const html=str(scenes[scene]?.html)||str(d.entryHtml)||str(obj(d.draft).gameHtml)||str(d.gameHtml);
  const visibleData=JSON.stringify(preview.type==='app'||preview.type==='game'?{html,appearance}:d);
  const {urls,dataUrls,failed,loading}=useAssets(recordKey,preview,visibleData);
  const mediaEntries=preview.assets.filter(a=>a.state==='stored'&&a.id);
  const placed=new Set<string>();
  const nativeMedia=()=>mediaEntries.filter(a=>!placed.has(a.ref)&&(a.mime?.startsWith('audio/')||a.mime?.startsWith('video/')));
  const font=urls[str(appearance.fontAssetId)],fontName=`inspection-${recordKey}`;
  const style:CSSProperties={fontSize:`${Math.max(14,Math.min(22,Number(appearance.fontSize)||16))}px`,fontFamily:font?fontName:str(appearance.fontFamily)||'system-ui',backgroundColor:str(theme['--c-page-body-bg'])||undefined,color:str(theme['--c-text-title'])||undefined};
  let content;
  if(preview.type==='app'||preview.type==='game'){
    for(const asset of mediaEntries)if(html.includes(asset.ref))placed.add(asset.ref);
    content=<>
    {scenes.length>0&&<div className="inspection-scene-tabs">{scenes.map((s,i)=><button className="btn btn-sm" key={i} aria-pressed={scene===i} onClick={()=>setScene(i)}>画面 {i+1}{s.at?` · ${new Date(str(s.at)).toLocaleTimeString()}`:''}</button>)}</div>}
    {html?<iframe title={`${title} 用户界面`} sandbox="" className="inspection-app-frame" srcDoc={inspectionHtml(html,dataUrls)}/>:<p className="inspection-missing">尚未留存用户画面。原设备打开此应用后会补传。</p>}
    <p className="inspection-preview-note">{scenes.length?'已显示画面的只读快照，可切换留存画面和滚动浏览。':'应用初始布局；动态画面需原设备补传。'}</p>
    {Object.keys(obj(d.collections)).length>0&&<details><summary>查看应用内容数据</summary><Prose value={d.collections} assets={dataUrls}/></details>}
  </>;
  }else if(preview.type==='vn'){
    const frames:Item[]=Array.isArray(d.frames)?list(d.frames):messages.flatMap(m=>{
      const text=str(m.rawContent);const parsed=completionContent(text);const p=obj(parsed);
      if(Array.isArray(p.frames))return list(p.frames);
      const matches=[...text.matchAll(/\[(?:bg|背景)[:：]([^\]]+)\]|\[(?:sprite|立绘)[:：]([^\]]+)\]|\[(?:speaker|角色)[:：]([^\]]+)\]/g)];
      return [{text,role:m.role,bg:matches.find(x=>x[1])?.[1],sprite:matches.find(x=>x[2])?.[2]}];
    });
    const frame=frames[Math.min(tab,Math.max(0,frames.length-1))]||{},prior=frames.slice(0,tab+1).reverse();
    const background=list(d.scenes).find(s=>s.name===prior.find(f=>f.bg!==undefined)?.bg),sprite=list(d.sprites).find(s=>s.key===prior.find(f=>f.sprite!==undefined)?.sprite);
    for(const asset of [...list(d.scenes),...list(d.sprites)])placed.add(str(asset.assetId));
    for(const f of frames)placed.add(str(obj(f.voiceAudio).audioDataUrl));
    content=<><div className="inspection-vn-stage" style={{backgroundImage:background&&urls[str(background.assetId)]?`url(${urls[str(background.assetId)]})`:undefined}}>
      {sprite&&urls[str(sprite.assetId)]&&<img className="inspection-vn-sprite" src={urls[str(sprite.assetId)]} alt={str(frame.sprite)}/>}
      <div className="inspection-vn-dialogue"><strong>{str(frame.speaker)||(frame.role==='user'?'用户':'旁白')}</strong><Prose value={frame.text||(frames.length?'场景切换':'这条留存只有章节信息，没有剧情正文。')} assets={dataUrls}/>{urls[str(obj(frame.voiceAudio).audioDataUrl)]&&<audio controls src={urls[str(obj(frame.voiceAudio).audioDataUrl)]}/>}</div>
    </div><div className="inspection-scene-tabs"><button className="btn" disabled={tab<=0} onClick={()=>setTab(t=>t-1)}>上一幕</button><span>{frames.length?`${tab+1} / ${frames.length}`:'暂无场景'}</span><button className="btn" disabled={tab>=frames.length-1} onClick={()=>setTab(t=>t+1)}>下一幕</button></div>{Array.isArray(obj(d.options).choices)&&<div className="inspection-scene-tabs">{(obj(d.options).choices as string[]).map((choice,i)=><span className="inspection-product" key={i}>{choice}</span>)}</div>}</>;
  } else if(preview.type==='conversation'||messages.length)content=<>
    {article.title&&<div className="inspection-scene-tabs"><button className="btn btn-sm" aria-pressed={!articleView} onClick={()=>setArticleView(false)}>访谈对话</button><button className="btn btn-sm" aria-pressed={articleView} onClick={()=>setArticleView(true)}>成刊</button></div>}
    {Boolean(d.sessionId)&&<div className="inspection-chat-header"><strong>{title}</strong><small className="inspection-chat-time">共 {Number(d.totalMessages)||messages.length} 条消息{Number(d.partCount)>1?` · 第 ${Number(d.partIndex)+1}/${Number(d.partCount)} 段`:''}</small></div>}
    {articleView?<article className="inspection-magazine"><small>在场 · PRESENCE</small><h2>{str(article.title)}</h2><p>{str(article.subtitle)}</p><blockquote>{str(article.pullQuote)}</blockquote><Prose value={article.body} assets={dataUrls}/>{list(article.qa).map((qa,i)=><section key={i}><h4>{str(qa.q)}</h4><Prose value={qa.a} assets={dataUrls}/></section>)}</article>:<div className="inspection-conversation">{messages.length?messages.map((m,i)=>{
      const media=str(m.mediaUrl||obj(m.mediaData).stickerUrl),asset=preview.assets.find(a=>a.ref===media),mime=asset?.mime||'';
      if(media)placed.add(media);
      return <div className={`inspection-bubble ${m.role==='user'?'is-user':''}`} key={str(m.id)||i}><strong>{str(m.senderName||m.name||m.speakerName||m.speaker)||({host:'主持人',user:'用户',assistant:'角色',character:str(d.characterName)||'受访角色'} as Record<string,string>)[str(m.role)]||str(m.role)||'发言人'}</strong><small className="inspection-chat-time">{str(m.createdAt)}</small><Prose value={m.content||m.rawContent||m.text} assets={dataUrls}/>
        {media&&(mime.startsWith('image/')?<Media value={media} urls={urls} label={str(obj(m.mediaData).fileName)||'聊天图片'}/>:mime.startsWith('audio/')?<audio controls src={urls[media]}/>:mime.startsWith('video/')?<video controls src={urls[media]}/>:<p className="inspection-message-detail">{str(obj(m.mediaData).fileName)||str(m.mediaType)||'附件'}，可在下方资源列表打开。</p>)}
        {!media&&Boolean(m.mediaType)&&<details className="inspection-message-detail"><summary>{str(m.mediaType)}详情</summary><Prose value={m.mediaData} assets={dataUrls}/></details>}
      </div>;
    }):<p>暂无留存对话。</p>}</div>}
  </>;
  else if(preview.type==='feed'&&Array.isArray(d.notes)){
    const notes=list(d.notes),note=notes[tab]||{},images=(n:Item)=>Array.isArray(n.imageAssetIds)?n.imageAssetIds as string[]:[str(n.imageAssetId||n.imageUrl||n.photoUrl)].filter(Boolean);
    for(const n of notes)for(const ref of [...images(n),str(n.imageUrl)])if(ref)placed.add(ref);
    content=feedDetail?<><button className="btn btn-sm" onClick={()=>setFeedDetail(false)}>返回笔记概览</button>{images(note).map((ref,i)=><Media key={i} value={ref} urls={urls} label={str(note.title)||'笔记配图'}/>)}<h2>{str(note.title)}</h2><p className="inspection-feed-author">{str(note.authorName)}</p><Prose value={note.body||note.videoDescription} assets={dataUrls}/><p>{Array.isArray(note.tags)?note.tags.map(tag=>`#${String(tag)}`).join(' '):''}</p><p>♡ {Number(note.likeCount)||0} · 收藏 {Number(note.saveCount)||0} · 评论 {Number(note.commentCount)||0}</p>{list(note.comments).map((comment,i)=><section className="inspection-product" key={i}><strong>{str(comment.authorName)}</strong><p>{comment.replyTo?`回复 ${str(comment.replyTo)}：`:''}{str(comment.text)}</p></section>)}</>:<div className="inspection-product-grid">{notes.map((n,i)=><button className="inspection-feed-card" key={i} onClick={()=>{setTab(i);setFeedDetail(true);}}>{urls[images(n)[0]||'']?<img src={urls[images(n)[0]!]} alt={str(n.title)}/>:<div className="inspection-feed-cover">{str(n.coverIcon)||'✦'}</div>}<strong>{str(n.title)}</strong><small>{str(n.authorName)} · ♡ {Number(n.likeCount)||0}</small></button>)}</div>;
  }
  else if(preview.type==='shopping')content=<>
    {list(obj(d.catalog).categories).map((category,i)=><section key={i}><h3>{str(category.title)}</h3><div className="inspection-product-grid">{list(category.items).map((item,j)=>{const image=str(item.imageUrl||item.imageData||item.coverImage);placed.add(image);return <div className="inspection-product" key={j}>{image?<Media value={image} urls={urls}/>:<div className="inspection-feed-cover">{str(item.previewIcon)}</div>}<strong>{str(item.title)}</strong><p>{str(item.description||item.subtitle)}</p><b>{str(item.priceLabel||item.price)}</b></div>;})}</div></section>)}
    {list(d.orders).map((order,i)=><div className="inspection-product" key={i}><strong>{str(order.statusLabel)}</strong><p>{str(order.timeLabel)} · {str(order.totalLabel)}</p><Prose value={order.items} assets={dataUrls}/></div>)}
  </>;
  else if(chapters.length)content=<><select aria-label="章节" value={tab} onChange={e=>setTab(Number(e.target.value))}>{chapters.map((c,i)=><option key={i} value={i}>{str(c.title)||`第 ${i+1} 章`}</option>)}</select><h2>{str(chapters[tab]?.title)}</h2><Prose value={chapters[tab]?.content||chapters[tab]?.paragraphs} assets={dataUrls}/></>;
  else content=<>{Object.entries(d).filter(([k])=>!['appearance','assets','collections','scenes','manifest','permissions','entryHtml','iconDataUrl','id','uid','canEdit','version','installedAt','updatedAt'].includes(k)).map(([key,value])=><section key={key}><Prose value={value} assets={dataUrls}/></section>)}</>;
  return <div className="inspection-preview" ref={root}>
    {font&&<style>{`@font-face{font-family:"${fontName}";src:url("${font}")}`}</style>}
    <div className="inspection-preview-toolbar"><select aria-label="预览尺寸" value={size} onChange={e=>setSize(e.target.value)}><option value="390">手机尺寸</option><option value="100%">适应窗口</option></select><button className="btn btn-sm" onClick={toggle}>{fullscreen?'退出全屏':'全屏'}</button><span>{loading?'正在加载素材…':preview.partial||failed?'部分预览 · 留存内容或素材不完整':'留存版本预览'}</span></div>
    <div className="inspection-phone" style={{...style,width:size==='390'?390:'100%'}}>{content}
      {preview.type!=='app'&&preview.type!=='game'&&mediaEntries.filter(a=>!placed.has(a.ref)&&a.mime?.startsWith('image/')).map((a,i)=><Media key={i} value={a.ref} urls={urls}/>)}
      {nativeMedia().map(a=>a.mime?.startsWith('video/')?<video key={a.id} controls preload="metadata" src={urls[a.ref]}/>:<audio key={a.id} controls preload="metadata" src={urls[a.ref]}/>)}
    </div>
    {preview.assets.length>0&&<section className="inspection-resources"><h4>关联资源 · {preview.assets.length} 项</h4><p className="inspection-preview-note">可查看完整留存文件、播放音视频或下载资源。</p>
      {preview.assets.slice(resourcePage*12,(resourcePage+1)*12).map((asset,index)=><article className="inspection-resource-card" key={`${asset.ref}:${index}`}><strong>{asset.name||`资源 ${resourcePage*12+index+1}`}</strong><small> · {asset.mime||'未知类型'}</small>
        {asset.state==='stored'&&asset.id?<RetainedMedia path={`/api/admin/phone-inspections/${encodeURIComponent(recordKey)}/assets/${asset.id}`} mime={asset.mime||'application/octet-stream'} label={asset.name||`资源-${asset.id}`} thumbnail={asset.mime?.startsWith('image/')?urls[asset.ref]:null}/>:<p className="inspection-missing">{asset.state==='too-large'?'文件超过当前上传上限，未留存':'文件尚未取得，等待原设备补传'}</p>}
      </article>)}
      {preview.assets.length>12&&<div className="inspection-scene-tabs"><button className="btn" disabled={resourcePage===0} onClick={()=>setResourcePage(p=>p-1)}>上一页资源</button><span>{resourcePage+1}/{Math.ceil(preview.assets.length/12)}</span><button className="btn" disabled={(resourcePage+1)*12>=preview.assets.length} onClick={()=>setResourcePage(p=>p+1)}>下一页资源</button></div>}
    </section>}
  </div>;
}
