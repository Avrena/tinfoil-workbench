/** Wait for the native top layer to reach the compositor before pointer input.
 * This also prevents the opening pointer sequence hitting controls underneath.
 * Keyboard focus remains available; no animation is required for this guard.
 */
const openings = new WeakMap<HTMLDialogElement, object>();
// Opening order. The top layer stacks dialogs in the order they were opened, which DOM order
// does not reflect (the message editor lives after every other dialog).
const order: HTMLDialogElement[] = [];
/** The most recently opened dialog that is still open, i.e. the one the user sees on top. */
export function topModal(): HTMLDialogElement | undefined {
  for (let i = order.length - 1; i >= 0; i--) if (order[i]!.open) return order[i];
  return undefined;
}
export function openModal(dialog: HTMLDialogElement): void {
  const token = {};
  openings.set(dialog, token);
  const at = order.indexOf(dialog);
  if (at >= 0) order.splice(at, 1);
  order.push(dialog);
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
