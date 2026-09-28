/** Wait for the native top layer to reach the compositor before pointer input.
 * This also prevents the opening pointer sequence hitting controls underneath.
 * Keyboard focus remains available; no animation is required for this guard.
 */
const openings = new WeakMap<HTMLDialogElement, object>();
export function openModal(dialog: HTMLDialogElement): void {
  const token = {};
  openings.set(dialog, token);
  if(!dialog.hasAttribute('aria-label')&&!dialog.hasAttribute('aria-labelledby')){
    const title=dialog.querySelector<HTMLElement>('h1,h2');
    if(title){title.id ||= (dialog.id||'workbench-dialog')+'-heading';dialog.setAttribute('aria-labelledby',title.id);}
    else if(dialog.id==='palette-dialog')dialog.setAttribute('aria-label','Command palette');
  }
  dialog.dataset.entering = '';
  dialog.showModal();
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    if (openings.get(dialog) === token) delete dialog.dataset.entering;
  }, 0)));
}
