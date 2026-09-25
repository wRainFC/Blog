export interface SideSheet {
  open(title: string, contents: string | Node, onReady?: (root: HTMLElement) => void): void;
  close(): void;
  isOpen(): boolean;
}

export function createSideSheet(root: HTMLElement, title: HTMLElement, body: HTMLElement, closeButton: HTMLButtonElement, backdrop: HTMLElement): SideSheet {
  let returnFocus: HTMLElement | null = null;
  const close = () => {
    root.hidden = true;
    backdrop.hidden = true;
    document.body.classList.remove("sheet-open");
    returnFocus?.focus();
    returnFocus = null;
  };
  closeButton.addEventListener("click", close);
  root.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  return {
    open(nextTitle, contents, onReady) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      title.textContent = nextTitle;
      body.replaceChildren();
      if (typeof contents === "string") body.innerHTML = contents;
      else body.append(contents);
      root.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("sheet-open");
      onReady?.(body);
      closeButton.focus();
    },
    close,
    isOpen: () => !root.hidden,
  };
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
