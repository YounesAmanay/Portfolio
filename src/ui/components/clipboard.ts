/**
 * Clipboard access, which fails more often than people expect: an insecure
 * origin, a denied permission, or a browser that predates the async API all
 * reject. The caller gets a boolean and shows feedback either way, because a
 * copy button that silently does nothing is worse than one that says it
 * could not.
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based path.
  }

  try {
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.style.position = 'fixed';
    scratch.style.opacity = '0';
    document.body.appendChild(scratch);
    scratch.select();
    const ok = document.execCommand('copy');
    scratch.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Flashes a transient label on a button, then restores it. Purely presentational
 * confirmation — the action already happened.
 */
export function flash(button: HTMLButtonElement, message: string, ms = 1400): void {
  const original = button.textContent;
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, ms);
}
