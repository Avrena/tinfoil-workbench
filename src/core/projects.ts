import type { Project, Workspace, Thread } from './types.js';
import { addThread, findThread, uid } from './workspace.js';
import { InputError, text } from './validation.js';
export function findProject(w:Workspace,id:string):Project {
  const project=w.projects.find(p=>p.id===id);if(!project)throw new InputError('Project not found.');return project;
}
function projectName(w:Workspace,name:unknown,except?:string):string {
  const value=text(name,'Project name',80,true).trim();
  if(w.projects.some(p=>p.id!==except&&p.name.toLocaleLowerCase()===value.toLocaleLowerCase()))throw new InputError('A project with this name already exists.');
  return value;
}
export function createProject(w:Workspace,name:unknown):Project {
  if(w.projects.length>=100)throw new InputError('Project limit reached.');
  const project={id:uid(),name:projectName(w,name),createdAt:Date.now()};w.projects.push(project);return project;
}
export function renameProject(w:Workspace,id:string,name:unknown):void {const p=findProject(w,id);p.name=projectName(w,name,id);}
/** Removing an organizational folder never deletes conversations. */
export function removeProject(w:Workspace,id:string):void {
  findProject(w,id);w.projects=w.projects.filter(p=>p.id!==id);for(const t of w.threads)if(t.projectId===id)t.projectId=null;
}
export function moveThread(w:Workspace,id:string,projectId:string|null):void {
  if(projectId!==null)findProject(w,projectId);const t=findThread(w,id);t.projectId=projectId;t.updatedAt=Date.now();
}
export function newProjectThread(w:Workspace,projectId?:string|null):Thread {
  const source=findThread(w,w.activeId),project=projectId===undefined?source.projectId??null:projectId;
  if(project!==null)findProject(w,project);
  const thread=addThread(w,source.settings);thread.projectId=project;return thread;
}
