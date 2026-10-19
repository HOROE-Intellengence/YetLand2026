// The inspection document has no scripting privileges and no network sources.
export const INSPECTION_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline' data: blob:; font-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function inspectionHtml(html: string, assets: Record<string,string> = {}): string {
  let source = html;
  for (const [ref,url] of Object.entries(assets)) source=source.split(ref).join(url);
  const doc=new DOMParser().parseFromString(source,'text/html');
  doc.querySelectorAll('script,iframe,object,embed,base,meta[http-equiv]').forEach(n=>n.remove());
  doc.querySelectorAll('*').forEach(node=>{
    for(const attr of Array.from(node.attributes)){
      if(/^on/i.test(attr.name)||['srcdoc','action','formaction','ping'].includes(attr.name))node.removeAttribute(attr.name);
      if(attr.name==='href'&&node.tagName!=='LINK')node.removeAttribute('href');
      if(['src','poster','href','xlink:href'].includes(attr.name)&& !/^(data:|blob:|#)/.test(attr.value))node.removeAttribute(attr.name);
    }
  });
  const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content=INSPECTION_CSP;doc.head.prepend(policy);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}
