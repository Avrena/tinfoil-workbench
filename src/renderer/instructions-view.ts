import type { GenerationSettings, InstructionPreset } from '../core/types.js';
import { STARTER_INSTRUCTIONS, activeInstructions, instructionExcerpt } from '../core/instructions.js';
import { escapeHtml as e } from '../core/markdown.js';
import { icon } from './icons.js';

/** Composer summary. Unnamed text is still labelled, never shown in full. */
export function instructionsSummary(settings:GenerationSettings,saved:readonly InstructionPreset[]):{set:boolean;name:string;label:string} {
  const active=activeInstructions(settings,saved);
  if(active.kind==='none')return {set:false,name:'',label:'System instructions (optional): none — provider defaults. Choose instructions'};
  const name=active.kind==='custom'?active.name:active.preset.name;
  return {set:true,name:name||'Custom',label:`System instructions (optional): ${name||'custom instructions'}. Change instructions`};
}

function option(key:string,title:string,detail:string,current:boolean,locked:boolean,edit?:{key:string;label:string;glyph:string}):string {
  return `<div class="instruction-row"><button type="button" class="instruction-option" data-instructions="${e(key)}" aria-current="${current}" ${locked&&!current?'disabled':''}><span class="instruction-copy"><strong>${e(title)}</strong><small>${e(detail)}</small></span>${current?`<span class="instruction-check" aria-hidden="true">${icon('check')}</span>`:''}</button>${edit?`<button type="button" class="icon-button instruction-edit" data-action="instructions-edit" data-edit="${e(edit.key)}" title="${e(edit.label)}" aria-label="${e(edit.label)}">${icon(edit.glyph)}</button>`:''}</div>`;
}

/** Selecting an entry copies its text into the conversation; nothing here sends a request. */
export function instructionsListMarkup(settings:GenerationSettings,saved:readonly InstructionPreset[],locked:boolean):string {
  const active=activeInstructions(settings,saved);
  const isCurrent=(kind:'saved'|'starter',p:InstructionPreset):boolean=>active.kind===kind&&active.preset.id===p.id;
  const current=active.kind==='custom'?`<h3 class="instruction-heading">This conversation</h3>${option('current',active.name||'Custom instructions',instructionExcerpt(active.text),true,locked,{key:'current',label:'Edit this conversation’s instructions',glyph:'write'})}`:'';
  const own=saved.length?saved.map(p=>option('saved:'+p.id,p.name,instructionExcerpt(p.text),isCurrent('saved',p),locked,{key:'saved:'+p.id,label:`Edit saved instructions “${p.name}”`,glyph:'write'})).join(''):'<p class="instruction-empty">Instructions you save appear here. They stay in this device’s encrypted workspace.</p>';
  const starters=STARTER_INSTRUCTIONS.map(p=>option('starter:'+p.id,p.name,instructionExcerpt(p.text),isCurrent('starter',p),locked,{key:'starter:'+p.id,label:`Customize a copy of “${p.name}”`,glyph:'copy'})).join('');
  return `${option('none','None','Provider defaults. No custom system message is sent.',active.kind==='none',locked)}${current}<h3 class="instruction-heading">Saved</h3>${own}<h3 class="instruction-heading">Starters</h3>${starters}`;
}
