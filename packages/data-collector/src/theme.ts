// Light or dark, as the host page says: `?theme=light|dark` when it loads the app, then a
// {action: "theme", theme} message whenever the participant switches. Without either, the system
// setting decides (styles.css). Only messages from this app's own origin are listened to.
const apply = (theme: unknown): void => {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
};

export function followHostTheme (): void {
  apply(new URLSearchParams(window.location.search).get("theme"));
  window.addEventListener("message", (event) => {
    if (event.origin === window.location.origin && event.data?.action === "theme") apply(event.data.theme);
  });
}
