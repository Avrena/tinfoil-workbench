/** A small keyed reconciler for trusted renderer templates. It is not a sanitizer.
 * Model HTML still goes through Markdown escaping or an opaque artifact frame.
 * data-artifact-host nodes belong to their card controller; never walk their DOM. */
const key=(node:Node):string|null=>node instanceof Element ? node.getAttribute('data-key')||(node.id||null) : null;
const compatible=(a:Node,b:Node):boolean=>a.nodeType===b.nodeType&&(!(a instanceof Element)||b instanceof Element&&a.tagName===b.tagName&&a.namespaceURI===b.namespaceURI);
function attributes(old:Element,next:Element):void {
  for(const a of [...old.attributes])if(!next.hasAttribute(a.name)&&a.name!=='open'&&a.name!=='style')old.removeAttribute(a.name);
  for(const a of [...next.attributes]) {
    if(a.name==='open')continue; // A reader's disclosure state wins over templates.
    if(a.name==='class'&&old.classList.contains('code-block')&&old.classList.contains('wrap')) {old.className=a.value+' wrap';continue;}
    if(old.getAttribute(a.name)!==a.value)old.setAttribute(a.name,a.value);
  }
}
function children(parent:Node,next:Node):void {
  let cursor=parent.firstChild;
  const keyed=new Map([...parent.childNodes].map(n=>[key(n),n]).filter(([k])=>!!k) as [string,Node][]);
  for(const desired of [...next.childNodes]) {
    const k=key(desired);let target=k?keyed.get(k):cursor&&(!key(cursor))&&compatible(cursor,desired)?cursor:undefined;
    if(target&&!compatible(target,desired))target=undefined;
    if(!target){target=desired.cloneNode(true);parent.insertBefore(target,cursor);}
    else {
      if(target!==cursor)parent.insertBefore(target,cursor);
      if(target instanceof Element&&desired instanceof Element){
        if(!target.hasAttribute('data-artifact-host')&&!target.hasAttribute('data-reply-host')&&!target.hasAttribute('data-rich-host')) {attributes(target,desired);children(target,desired);}
      } else if(target.nodeValue!==desired.nodeValue) target.nodeValue=desired.nodeValue;
    }
    cursor=target.nextSibling;
  }
  while(cursor){const nextNode=cursor.nextSibling;parent.removeChild(cursor);cursor=nextNode;}
}
export function updateMarkup(element:HTMLElement,html:string):void {
  const template=document.createElement('template');template.innerHTML=html;
  children(element,template.content);
}
